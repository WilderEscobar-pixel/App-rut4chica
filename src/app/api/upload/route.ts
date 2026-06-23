import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { processPdfBuffer } from '@/lib/ocr-engine'
import { parsePdfWithLLM } from '@/lib/pdf-parser-llm'

// ─── Excel Parsing ──────────────────────────────────────────────────

interface ExcelProduct {
  code: string
  originalCode: string | null
  barcode: string | null
  description: string
  totalRequested: number
  bulto: number
  origen: string
}

async function parseExcelFile(buffer: Buffer): Promise<ExcelProduct[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false })

  const reporteSheet = workbook.SheetNames.find(
    (name) => name.toLowerCase().includes('reporte')
  )
  const sheetName = reporteSheet || workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (rawRows.length < 2) return []

  const headerRow = rawRows[0].map((h) => String(h || '').trim())

  // Column A = original 5-digit product code ("Código")
  let codeColIndex = 0
  // Column H = EAN-13 barcode ("Código Barra")
  let barcodeColIndex = 7

  const colIndex: Record<string, number> = {}
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i].toLowerCase()
    colIndex[h] = i

    if (h === 'código' || h === 'codigo' || h === 'code' || h === 'cod') {
      codeColIndex = i
    }
    if (h.includes('barra') || h === 'ean' || h === 'upc' ||
        h === 'codigo barra' || h === 'código barra' || h === 'codigo de barra' || h === 'código de barra') {
      barcodeColIndex = i
    }
  }

  function getVal(row: unknown[], col: string): string {
    const idx = colIndex[col.toLowerCase()]
    return idx !== undefined && idx < row.length ? String(row[idx] || '').trim() : ''
  }

  function getNum(row: unknown[], col: string): number {
    const idx = colIndex[col.toLowerCase()]
    if (idx === undefined || idx >= row.length) return 0
    const v = row[idx]
    if (typeof v === 'number') return v
    const n = Number(v)
    return Number.isNaN(n) ? 0 : n
  }

  const products: ExcelProduct[] = []

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r]

    const originalCode = String(row[codeColIndex] || '').trim()
    const barcode = String(row[barcodeColIndex] || '').trim()

    if (!barcode || barcode === '0' || barcode.startsWith('=') || barcode.startsWith('#')) continue

    const description = getVal(row, 'DESCRIPCION')
      || getVal(row, 'DESCRIPCIÓN')
      || getVal(row, 'DESC')
      || getVal(row, 'PRODUCTO')
      || ''

    const totalRequested = getNum(row, 'CANT. SOLICITADA')
      || getNum(row, 'CANTIDAD SOLICITADA')
      || getNum(row, 'TOTAL')
      || getNum(row, 'CANTIDAD')
      || getNum(row, 'CANT')
      || 0

    const bulto = getNum(row, 'BULTO DESPACHADO')
      || getNum(row, 'BULTO')
      || getNum(row, 'PKG')
      || 0

    const origen = getVal(row, 'ORIGEN') || 'R'

    if (barcode && description) {
      products.push({
        code: barcode,
        originalCode: originalCode || null,
        barcode: originalCode || null,
        description,
        totalRequested: Math.max(0, totalRequested),
        bulto: Math.max(0, bulto),
        origen: origen || 'R',
      })
    }
  }

  return products
}

// ─── PDF Worker/Assignment Parsing (REGEX - Primary Method) ──────────

interface PdfWorker {
  code: string
  name: string
  itinerary: string
  rif: string
  assignments: Array<{
    productCode: string
    quantity: number
  }>
}

/**
 * Comprehensive set of address-related Spanish words that should NOT be
 * matched as product codes.
 */
const ADDRESS_WORDS = new Set([
  'CALLE', 'CARRERA', 'KRA', 'CL', 'DG', 'TV', 'TRANSVERSAL', 'DIAGONAL',
  'AUTOPISTA', 'AVENIDA', 'AV', 'GLORIETA', 'CALLEJON', 'CARR',
  'BARRIO', 'SECTOR', 'ZONA', 'URB', 'URBANIZACION', 'MUNICIPIO',
  'DEPARTAMENTO', 'VEREDA', 'LOCALIDAD', 'CORREGIMIENTO',
  'PISO', 'LOCAL', 'OFICINA', 'INTERIOR', 'BLOQUE', 'TORRE', 'APARTAMENTO',
  'APT', 'APTO', 'EDIFICIO', 'CASA', 'MANZANA', 'LOTE', 'ETAPA',
  'POSTAL', 'SUR', 'NORTE', 'ESTE', 'OESTE', 'BIS',
  'VDA', 'VIUDA', 'LOS', 'LAS', 'EL', 'LA', 'DE', 'DEL', 'NO',
  'NUM', 'NUMERO', 'NRO', '#', 'KM', 'LT',
  'RIF', 'NIT', 'CC', 'CE', 'TI',
])

/**
 * Check if a token looks like a valid product code.
 * Product codes are typically:
 * - 4-6 digit numbers (e.g., "10204", "10680")
 * - 2 letters + 3-4 digits (e.g., "MN076", "GN101")
 * - Short alphanumeric codes that are NOT address words
 */
function isValidProductCode(token: string, validProductCodes?: Set<string>): boolean {
  const upper = token.toUpperCase().trim()

  if (!upper || upper.length < 2 || upper.length > 10) return false
  if (ADDRESS_WORDS.has(upper)) return false

  // If we have a set of valid product codes, check against it
  if (validProductCodes && validProductCodes.size > 0) {
    if (validProductCodes.has(upper)) return true
  }

  // Pure numeric codes (4-6 digits)
  if (/^\d{4,6}$/.test(upper)) return true

  // Letter-prefix codes: 1-3 letters followed by 2-4 digits (e.g., MN076, GN101)
  if (/^[A-Z]{1,3}\d{2,4}$/.test(upper)) return true

  // Numeric codes with letter suffix (e.g., 477X, 516X) - these are worker codes, NOT product codes
  if (/^\d+[A-Z]{1,2}$/.test(upper)) return false

  return false
}

/**
 * Parse the PDF text to extract worker information and their product assignments.
 *
 * Actual PDF format from "Droguería Nena" Ruta Chica (pdf-parse output):
 *
 *   CODIGO: RUTA: ZONA:
 *   DESCRIPCIÓN	CANT. CÓDIGO
 *   ...
 *   Serie:
 *   212X CHICA X                          <- Worker code (before "CHICA")
 *   ARAMBARRIO MARTINEZ, ANA KARINA       <- Worker name (next line)
 *   ...
 *   V198609761                            <- RIF (standalone V+digits)
 *   ITINERARIO:
 *   A
 *   1826                                  <- Itinerary
 *   ESOMEPRAZOL DAC40 X20CA	18149	1    <- DESC <tab> CODE <tab> QTY
 *
 * Strategy: split by CODIGO: marker (like old proven version),
 * extract metadata via Serie:/ITINERARIO:/RIF patterns,
 * extract product lines from tab-separated data.
 */
function parsePdfText(text: string, validProductCodes?: Set<string>): PdfWorker[] {
  const workers: PdfWorker[] = []

  if (!text || text.trim().length === 0) {
    console.log('[PDF-Regex] Empty text provided')
    return []
  }

  console.log(`[PDF-Regex] Starting regex parse, text length: ${text.length}`)

  // Split by CODIGO: marker (lookahead — proven approach from working version)
  // This correctly separates invoices even when page breaks don't align
  const invoiceBlocks = text.split(/(?=CODIGO\s*:)/i)
  console.log(`[PDF-Regex] Found ${invoiceBlocks.length} invoice blocks`)

  for (const block of invoiceBlocks) {
    if (!block.trim()) continue

    const lines = block.split(/\n/)

    // ── Extract worker code ──
    // Try multiple patterns: CODIGO: XXXX (old format), Serie: / code+CHICA (new format)
    let workerCode = ''

    // Pattern 1: "CODIGO: XXXX" on a single line (old format)
    // Exclude metadata keywords that appear after CODIGO: in broken-format PDFs
    const codeMatch = block.match(/CODIGO\s*:\s*([A-Z0-9]+)\b/i)
    if (codeMatch) {
      const rawCode = codeMatch[1].trim().toUpperCase()
      // Exclude known metadata keywords (not worker codes)
      if (!/^(RUTA|ZONA|CHICA|PAG|ITINERARIO|FECHA|SERIE|RELACI|ENTREGA|DESCRIPCI|CREDITO|FORMATO)$/i.test(rawCode)) {
        workerCode = rawCode
      }
    }

    // Pattern 2: "Serie:" followed by "XXXX CHICA X" on next line (new format)
    if (!workerCode) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (/^Serie\s*:?\s*$/i.test(line) && i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim()
          const codeFromSerie = nextLine.match(/^([A-Z0-9]+)\s+CHICA/i)
          if (codeFromSerie) {
            workerCode = codeFromSerie[1].toUpperCase()
            break
          }
        }
      }
    }

    // Pattern 3: Standalone "XXXX CHICA" line (direct format)
    if (!workerCode) {
      const metadataKeywords = /^(RUTA|ZONA|CHICA|PAG|ITINERARIO|FECHA|SERIE|RELACI|ENTREGA|DESCRIPCI|CREDITO|FORMATO|CODIGO)$/i
      for (const line of lines) {
        const trimmed = line.trim()
        const directMatch = trimmed.match(/^([A-Z0-9]+)\s+CHICA\b/i)
        if (directMatch) {
          const rawCode = directMatch[1].toUpperCase()
          if (!metadataKeywords.test(rawCode)) {
            workerCode = rawCode
            break
          }
        }
      }
    }

    if (!workerCode) continue

    // ── Extract worker name (line after the code+CHICA line) ──
    let workerName = ''
    let foundCodeLine = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (foundCodeLine) {
        if (line && line.length > 3 &&
            !/^(CODIGO|RUTA|ZONA|PAG|RIF|RELACI|SERIE|ITINERARIO|URB\b|CALLE|CARRERA|BARRIO|SECTOR|VDA\b|AVENIDA|CR |MUNICIPIO|BARQUISIMETO|LARA|ZONA POSTAL)/i.test(line) &&
            !/^\d{2}-\d{2}-\d{4}/.test(line) &&
            !/^[VEJ]\d{6,}/.test(line)) {
          workerName = line
          break
        } else {
          foundCodeLine = false
        }
      }
      if (line.includes(workerCode) && /CHICA/i.test(line)) {
        foundCodeLine = true
      }
    }

    // ── Extract itinerary ──
    let itinerary = '0'
    // Direct format: "ITINERARIO: NNN"
    const itMatch = block.match(/ITINERARIO\s*:\s*(\d+)/i)
    if (itMatch) {
      itinerary = itMatch[1].trim()
    } else {
      // Multi-line format: ITINERARIO:\nA\nNNN
      for (let i = 0; i < lines.length; i++) {
        if (/^ITINERARIO\s*:?\s*$/i.test(lines[i].trim())) {
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nl = lines[j].trim()
            if (/^\d{1,6}$/.test(nl)) {
              itinerary = nl
              break
            }
            if (nl === 'A' || nl === 'B') continue
            break
          }
          if (itinerary !== '0') break
        }
      }
    }

    // ── Extract RIF ──
    let rif = ''
    // Pattern 1: "RIF: XXXX"
    const rifMatch = block.match(/RIF\s*:\s*([A-Z0-9\-]+)/i)
    if (rifMatch) {
      rif = rifMatch[1].trim().toUpperCase()
    } else {
      // Pattern 2: Standalone V/J/E + 6-10 digits
      for (const line of lines) {
        const trimmed = line.trim()
        if (/^[VEJ]\d{6,10}$/i.test(trimmed)) {
          rif = trimmed.toUpperCase()
          break
        }
      }
    }

    // ── Extract product assignments ──
    const assignments: Array<{ productCode: string; quantity: number }> = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Skip header/metadata lines
      if (/^(CODIGO|RUTA|ZONA|PAG|RIF|RELACI|SERIE|ITINERARIO|DESCRIPCI|CANT\.|Total Unidades|Sin Derecho|Fecha)/i.test(trimmed)) continue
      if (/^\d{2}-\d{2}-\d{4}/.test(trimmed)) continue
      if (/^[VEJ]\d{6,10}$/i.test(trimmed)) continue
      if (/^(URB\b|CALLE|CARRERA|BARRIO|SECTOR|VDA\b|CR |AVENIDA|MUNICIPIO|BARQUISIMETO|LARA|ZONA POSTAL)/i.test(trimmed)) continue

      // ── Primary format: tab-separated ──
      // DESCRIPTION \t CODE \t QUANTITY
      const parts = trimmed.split(/\t/)
      if (parts.length >= 3) {
        const last2 = parts.slice(-2).map(s => s.trim())
        // Try both orders: code-then-qty and qty-then-code
        for (const [a, b] of [[last2[0], last2[1]], [last2[1], last2[0]]]) {
          const qtyNum = parseInt(a, 10)
          if (/^\d{1,3}$/.test(a) && qtyNum > 0 && qtyNum <= 999 &&
              isValidProductCode(b, validProductCodes)) {
            assignments.push({ productCode: b.toUpperCase(), quantity: qtyNum })
            break
          }
        }
        if (assignments.length > 0 && assignments[assignments.length - 1].productCode === parts[parts.length - 2]?.trim().toUpperCase()) continue
        if (assignments.length > 0 && assignments[assignments.length - 1].productCode === parts[parts.length - 1]?.trim().toUpperCase()) continue
      }

      // ── Fallback: space-separated QUANTITY CODE DESCRIPTION ──
      const qtyCodeMatch = trimmed.match(/^\s*(\d{1,3})\s{2,}([A-Z0-9]{2,10})\b/i)
      if (qtyCodeMatch) {
        const qty = parseInt(qtyCodeMatch[1], 10)
        const potentialCode = qtyCodeMatch[2].toUpperCase()
        if (qty > 0 && qty <= 999 && isValidProductCode(potentialCode, validProductCodes)) {
          // Avoid duplicates
          if (!assignments.some(a => a.productCode === potentialCode)) {
            assignments.push({ productCode: potentialCode, quantity: qty })
          }
        }
      }
    }

    workers.push({
      code: workerCode,
      name: workerName || `Trabajador ${workerCode}`,
      itinerary: itinerary || '0',
      rif: rif || '',
      assignments,
    })
  }

  console.log(`[PDF-Regex] Parsed ${workers.length} workers, ${workers.reduce((s, w) => s + w.assignments.length, 0)} total assignments`)
  for (const w of workers) {
    console.log(`[PDF-Regex]   Worker: ${w.name} (Cod: ${w.code}, It: ${w.itinerary}) - ${w.assignments.length} assignments`)
  }

  return workers
}

// ─── Main Upload Handler ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  console.log('[Upload] Starting file upload processing...')

  const errors: string[] = []
  let productsCreated = 0
  let workersCreated = 0
  let workersUpdated = 0
  let assignmentsCreated = 0
  let ocrMethod: string | undefined
  let ocrPages: number | undefined
  let ocrConfidence: number | undefined
  let parsingMethod: string | undefined

  try {
    const formData = await request.formData()
    const sessionId = formData.get('sessionId') as string | null

    if (!sessionId) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['sessionId es requerido'] } },
        { status: 400 }
      )
    }

    // Verify session exists
    const session = await db.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['Sesión no encontrada'] } },
        { status: 404 }
      )
    }

    // ─── Step 1: Collect Excel files ──────────────────────────────────
    const excelFiles: Buffer[] = []
    let excelIndex = 0
    while (true) {
      const key = excelIndex === 0 ? 'excel' : `excel_${excelIndex}`
      const file = formData.get(key) as File | null
      if (!file) break
      const buffer = Buffer.from(await file.arrayBuffer())
      excelFiles.push(buffer)
      excelIndex++
    }

    // Also check for multiple files in a single 'excel' field
    const allExcelEntries = [...formData.getAll('excel')].filter(f => f instanceof File) as File[]
    for (const file of allExcelEntries) {
      if (!excelFiles.some(buf => buf.length === (file as File).size)) {
        excelFiles.push(Buffer.from(await file.arrayBuffer()))
      }
    }

    if (excelFiles.length === 0) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['No se encontraron archivos Excel'] } },
        { status: 400 }
      )
    }

    // ─── Step 2: Parse all Excel files and merge products ────────────
    const allProducts: ExcelProduct[] = []
    for (let i = 0; i < excelFiles.length; i++) {
      try {
        const products = await parseExcelFile(excelFiles[i])
        console.log(`[Upload] Excel file ${i + 1}: ${products.length} products parsed`)
        for (const p of products) {
          const existing = allProducts.find(ep => ep.code === p.code)
          if (existing) {
            existing.totalRequested += p.totalRequested
          } else {
            allProducts.push({ ...p })
          }
        }
      } catch (err) {
        const msg = `Error procesando archivo Excel ${i + 1}: ${err instanceof Error ? err.message : 'Error desconocido'}`
        console.error(msg)
        errors.push(msg)
      }
    }

    console.log(`[Upload] Total unique products from ${excelFiles.length} Excel file(s): ${allProducts.length}`)

    // Build a set of valid product codes for PDF matching (includes 5-digit codes from column A)
    const validProductCodes = new Set(allProducts.map(p => p.code.toUpperCase()))
    for (const p of allProducts) {
      if (p.originalCode) validProductCodes.add(p.originalCode.toUpperCase())
    }

    // Create products in database
    // code = EAN-13 barcode (column H) for scanning/display
    // barcode = original 5-digit code (column A) for PDF matching
    for (const p of allProducts) {
      try {
        await db.product.upsert({
          where: {
            code_sessionId: { code: p.code, sessionId },
          },
          create: {
            code: p.code,
            barcode: p.originalCode,
            description: p.description,
            totalRequested: p.totalRequested,
            bulto: p.bulto,
            origen: p.origen,
            sessionId,
          },
          update: {
            description: p.description,
            totalRequested: p.totalRequested,
            bulto: p.bulto,
            origen: p.origen,
            barcode: p.originalCode,
          },
        })
        productsCreated++
      } catch (err) {
        errors.push(`Error guardando producto ${p.code}: ${err instanceof Error ? err.message : 'Error desconocido'}`)
      }
    }

    // ─── Step 3: Collect PDF files ───────────────────────────────────
    const pdfFiles: Buffer[] = []
    let pdfIndex = 0
    while (true) {
      const key = pdfIndex === 0 ? 'pdf' : `pdf_${pdfIndex}`
      const file = formData.get(key) as File | null
      if (!file) break
      const buffer = Buffer.from(await file.arrayBuffer())
      pdfFiles.push(buffer)
      pdfIndex++
    }

    const allPdfEntries = [...formData.getAll('pdf')].filter(f => f instanceof File) as File[]
    for (const file of allPdfEntries) {
      if (!pdfFiles.some(buf => buf.length === (file as File).size)) {
        pdfFiles.push(Buffer.from(await file.arrayBuffer()))
      }
    }

    // ─── Step 4: Process PDF files → Workers & Assignments ───────────
    if (pdfFiles.length === 0) {
      console.log('[Upload] No PDF files provided, skipping worker/assignment creation')
    } else {
      const allWorkers: PdfWorker[] = []
      const allPdfTexts: string[] = []

      // Extract text from all PDFs (using pdftotext - fast)
      for (let i = 0; i < pdfFiles.length; i++) {
        try {
          const ocrResult = await processPdfBuffer(pdfFiles[i])
          if (i === 0) {
            ocrMethod = ocrResult.method
            ocrPages = ocrResult.pagesProcessed
            ocrConfidence = Math.round(ocrResult.confidence * 100)
          }

          console.log(`[Upload] PDF file ${i + 1}: extracted ${ocrResult.text.length} chars via ${ocrResult.method} (confidence: ${ocrResult.confidence})`)
          allPdfTexts.push(ocrResult.text)
        } catch (err) {
          const msg = `Error extrayendo texto del PDF ${i + 1}: ${err instanceof Error ? err.message : 'Error desconocido'}`
          console.error(msg)
          errors.push(msg)
        }
      }

      // Combine all PDF texts for parsing
      const combinedText = allPdfTexts.join('\n\f\n')
      const productCodeList = Array.from(validProductCodes)

      // ── Step 4a: Try regex-based parsing FIRST (instant, no API calls) ──
      let regexWorkers: PdfWorker[] = []
      try {
        console.log('[Upload] Attempting regex-based PDF parsing (primary method)...')
        regexWorkers = parsePdfText(combinedText, validProductCodes)
        console.log(`[Upload] Regex parsing result: ${regexWorkers.length} workers, ${regexWorkers.reduce((s, w) => s + w.assignments.length, 0)} assignments`)
      } catch (err) {
        console.error('[Upload] Regex parsing failed:', err)
      }

      const regexValidAssignments = regexWorkers.reduce((s, w) =>
        s + w.assignments.filter(a => validProductCodes.has(a.productCode.toUpperCase())).length, 0)

      let selectedWorkers: PdfWorker[]
      let needLlmSupplement = false

      // ── Step 4b: If regex found good results, use them directly (FAST PATH) ──
      if (regexValidAssignments > 0) {
        selectedWorkers = regexWorkers
        parsingMethod = 'regex'
        console.log(`[Upload] Using regex parsing (${regexValidAssignments} valid assignments)`)

        // Check if we should supplement with LLM (only if many workers have 0 assignments)
        const workersWithNoAssignments = regexWorkers.filter(w => w.assignments.length === 0).length
        if (workersWithNoAssignments > regexWorkers.length * 0.3) {
          needLlmSupplement = true
          console.log(`[Upload] ${workersWithNoAssignments}/${regexWorkers.length} workers have no assignments - will try LLM supplement`)
        }
      } else {
        // ── Step 4c: Regex found nothing - try LLM as fallback (SLOW PATH) ──
        console.log('[Upload] Regex found no valid assignments, trying LLM parsing...')
        let llmWorkers: PdfWorker[] = []
        try {
          llmWorkers = await parsePdfWithLLM(combinedText, productCodeList)
          console.log(`[Upload] LLM parsing result: ${llmWorkers.length} workers, ${llmWorkers.reduce((s, w) => s + w.assignments.length, 0)} assignments`)
        } catch (err) {
          console.error('[Upload] LLM parsing failed:', err)
          errors.push(`Error en parsing LLM: ${err instanceof Error ? err.message : 'Error desconocido'}`)
        }

        const llmValidAssignments = llmWorkers.reduce((s, w) =>
          s + w.assignments.filter(a => validProductCodes.has(a.productCode.toUpperCase())).length, 0)

        if (llmValidAssignments > 0) {
          selectedWorkers = llmWorkers
          parsingMethod = 'llm'
          console.log(`[Upload] Using LLM parsing (${llmValidAssignments} valid assignments)`)
        } else {
          // Both failed - use whichever found more data
          selectedWorkers = regexWorkers.length >= llmWorkers.length ? regexWorkers : llmWorkers
          parsingMethod = regexWorkers.length >= llmWorkers.length ? 'regex' : 'llm'
          console.log(`[Upload] Both methods limited - using ${parsingMethod}`)
        }

        // If LLM was primary, merge regex worker names (regex finds names better)
        if (parsingMethod === 'llm' && regexWorkers.length > 0) {
          for (const rw of regexWorkers) {
            const existing = selectedWorkers.find(sw => sw.code === rw.code)
            if (!existing) {
              if (rw.assignments.length > 0) {
                selectedWorkers.push({ ...rw })
              }
            } else if ((!existing.name || existing.name.startsWith('Trabajador')) && rw.name && !rw.name.startsWith('Trabajador')) {
              existing.name = rw.name
            }
          }
        }
      }

      // ── Optional: LLM supplement for workers with no assignments ──
      if (needLlmSupplement && combinedText.length < 200000) {
        console.log('[Upload] Supplementing with LLM for workers with missing assignments...')
        try {
          const llmWorkers = await parsePdfWithLLM(combinedText, productCodeList)

          for (const lw of llmWorkers) {
            const existing = selectedWorkers.find(sw => sw.code === lw.code)
            if (existing) {
              if (existing.assignments.length === 0 && lw.assignments.length > 0) {
                existing.assignments = lw.assignments
                console.log(`[Upload] LLM supplemented assignments for worker ${lw.code}: ${lw.assignments.length} assignments`)
              } else if (lw.assignments.length > existing.assignments.length) {
                existing.assignments = lw.assignments
                console.log(`[Upload] LLM found more assignments for worker ${lw.code}: ${lw.assignments.length} vs ${existing.assignments.length}`)
              }
              if ((!existing.name || existing.name.startsWith('Trabajador')) && lw.name && !lw.name.startsWith('Trabajador')) {
                existing.name = lw.name
              }
            } else {
              if (lw.assignments.length > 0) {
                selectedWorkers.push({ ...lw })
                console.log(`[Upload] LLM found new worker ${lw.code}: ${lw.assignments.length} assignments`)
              }
            }
          }
          parsingMethod = 'regex+llm'
        } catch (err) {
          console.error('[Upload] LLM supplement failed:', err)
          // Don't add to errors - regex already found good data
        }
      }

      // Merge into allWorkers (for cross-PDF-file deduplication)
      for (const w of selectedWorkers) {
        const existing = allWorkers.find(ew => ew.code === w.code)
        if (existing) {
          for (const a of w.assignments) {
            const existingAssignment = existing.assignments.find(ea => ea.productCode === a.productCode)
            if (existingAssignment) {
              existingAssignment.quantity += a.quantity
            } else {
              existing.assignments.push({ ...a })
            }
          }
          if (!existing.name || existing.name.startsWith('Trabajador')) {
            if (w.name && !w.name.startsWith('Trabajador')) {
              existing.name = w.name
            }
          }
        } else {
          allWorkers.push({ ...w })
        }
      }

      console.log(`[Upload] Total unique workers from ${pdfFiles.length} PDF file(s): ${allWorkers.length}, method: ${parsingMethod}`)

      // Create workers and assignments in database
      for (const w of allWorkers) {
        try {
          const worker = await db.worker.upsert({
            where: { code: w.code },
            create: {
              code: w.code,
              name: w.name,
              itinerary: w.itinerary,
              rif: w.rif,
            },
            update: {
              name: w.name,
              itinerary: w.itinerary,
              rif: w.rif,
            },
          })

          if (worker) {
            workersCreated++
          }

          for (const a of w.assignments) {
            const pdfCode = a.productCode.toUpperCase()

            // Find product by matching PDF code against:
            // 1. product.code (barcode EAN-13) - direct scan match
            // 2. product.barcode (original 5-digit code from column A) - PDF match
            let product = await db.product.findFirst({
              where: {
                sessionId,
                OR: [
                  { code: pdfCode },
                  { barcode: pdfCode },
                  { code: { equals: pdfCode } },
                ],
              },
            })

            // Try without leading zeros
            if (!product && /^0+\d+$/.test(pdfCode)) {
              const stripped = pdfCode.replace(/^0+/, '')
              product = await db.product.findFirst({
                where: {
                  sessionId,
                  OR: [
                    { code: stripped },
                    { barcode: stripped },
                  ],
                },
              })
            }

            if (!product) {
              console.log(`[Upload] Product ${a.productCode} not found in session, skipping assignment for worker ${w.code}`)
              continue
            }

            try {
              await db.assignment.upsert({
                where: {
                  workerId_productId_sessionId: {
                    workerId: worker.id,
                    productId: product.id,
                    sessionId,
                  },
                },
                create: {
                  workerId: worker.id,
                  productId: product.id,
                  productCode: product.code,
                  quantity: a.quantity,
                  sessionId,
                },
                update: {
                  quantity: a.quantity,
                },
              })
              assignmentsCreated++
            } catch (assignErr) {
              errors.push(`Error creando asignación ${w.code}->${a.productCode}: ${assignErr instanceof Error ? assignErr.message : 'Error desconocido'}`)
            }
          }
        } catch (workerErr) {
          errors.push(`Error procesando trabajador ${w.code}: ${workerErr instanceof Error ? workerErr.message : 'Error desconocido'}`)
        }
      }
    }

    const result = {
      productsCreated,
      workersCreated,
      workersUpdated,
      assignmentsCreated,
      errors,
      ocrMethod,
      ocrPages,
      ocrConfidence,
      parsingMethod,
    }

    console.log(`[Upload] Result: ${productsCreated} products, ${workersCreated} workers, ${assignmentsCreated} assignments, ${errors.length} errors, method: ${parsingMethod}`)

    return NextResponse.json({
      success: errors.length === 0 || productsCreated > 0 || assignmentsCreated > 0,
      results: result,
    })
  } catch (error) {
    console.error('[Upload] Fatal error:', error)
    return NextResponse.json(
      {
        success: false,
        results: {
          productsCreated,
          workersCreated,
          workersUpdated,
          assignmentsCreated,
          errors: [...errors, `Error fatal: ${error instanceof Error ? error.message : String(error)}`],
          ocrMethod,
          ocrPages,
          ocrConfidence,
        },
      },
      { status: 500 }
    )
  }
}
