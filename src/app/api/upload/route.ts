import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { processPdfBuffer } from '@/lib/ocr-engine'
import { parsePdfWithLLM } from '@/lib/pdf-parser-llm'

// ─── Excel Parsing ──────────────────────────────────────────────────

interface ExcelProduct {
  code: string
  description: string
  totalRequested: number
  bulto: number
  origen: string
}

async function parseExcelFile(buffer: Buffer): Promise<ExcelProduct[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const products: ExcelProduct[] = []

  for (const row of rows) {
    // Try multiple column name patterns (Spanish and English)
    const code = String(
      row['CODIGO'] || row['Código'] || row['codigo'] || row['Code'] || row['CODE'] || row['COD'] || row['Cod'] || ''
    ).trim()

    if (!code) continue

    const description = String(
      row['DESCRIPCION'] || row['Descripción'] || row['descripcion'] || row['Description'] || row['DESC'] || row['Producto'] || row['PRODUCTO'] || ''
    ).trim()

    const totalRequested = Number(
      row['Cant. Solicitada'] || row['CANT. SOLICITADA'] || row['Cantidad Solicitada'] ||
      row['TOTAL'] || row['Total'] || row['CANTIDAD'] || row['Cantidad'] || row['cantidad'] ||
      row['Quantity'] || row['QTY'] || row['CANT'] || row['Cant'] || row['Cant. Despachada'] || 0
    )

    const bulto = Number(
      row['Bulto Despachado'] || row['BULTO DESPACHADO'] || row['Bulto Desp.'] ||
      row['BULTO'] || row['Bulto'] || row['bulto'] || row['Package'] || row['PKG'] || 0
    )

    const origen = String(
      row['ORIGEN'] || row['Origen'] || row['origen'] || row['Origin'] || row['O'] || 'R'
    ).trim()

    if (code && description) {
      products.push({
        code,
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
 * The PDF from "Droguería Nena" Ruta Chica system has this format per invoice:
 *
 *   CODIGO: 0169          RUTA: CHICA ZONA: X         ITINERARIO: 831       PAG:1 / 1
 *   MANZANO ANGEL
 *   ...
 *   RIF:     V211418032
 *   CANT.   CÓDIGO   DESCRIPCIÓN
 *    1       19967   CEFADROXAN 500MG. X10CA
 *    1       22391   VITAMINA C BIO 500MG X60
 *   Total Unidades: 2
 *
 * CRITICAL: Product lines have format: QUANTITY  PRODUCT_CODE  DESCRIPTION
 * The quantity comes FIRST, then the product code, then the description.
 */
function parsePdfText(text: string, validProductCodes?: Set<string>): PdfWorker[] {
  const workers: PdfWorker[] = []

  if (!text || text.trim().length === 0) {
    console.log('[PDF-Regex] Empty text provided')
    return []
  }

  console.log(`[PDF-Regex] Starting regex parse, text length: ${text.length}`)

  // Split into invoice blocks at each CODIGO: marker
  const invoiceBlocks = text.split(/(?=CODIGO\s*:)/i)
  console.log(`[PDF-Regex] Found ${invoiceBlocks.length} invoice blocks`)

  for (const block of invoiceBlocks) {
    if (!block.trim()) continue

    // ── Extract worker code ──
    let workerCode = ''
    const codeMatch = block.match(/CODIGO\s*:\s*([A-Z0-9]+)/i)
    if (codeMatch) {
      workerCode = codeMatch[1].trim().toUpperCase()
    }
    if (!workerCode) continue

    // ── Extract itinerary ──
    let itinerary = '0'
    const itMatch = block.match(/ITINERARIO\s*:\s*(\d+)/i)
    if (itMatch) {
      itinerary = itMatch[1].trim()
    }

    // ── Extract worker name ──
    // In the actual PDF, the name is on the line immediately after CODIGO:
    let workerName = ''
    const lines = block.split(/\n/)

    // Find the CODIGO line and take the next non-empty line as the name
    for (let i = 0; i < lines.length; i++) {
      if (/CODIGO\s*:/i.test(lines[i])) {
        // The next non-empty line is the worker name
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextLine = lines[j].trim()
          if (!nextLine) continue
          // Skip if it looks like metadata
          if (/RUTA|ZONA|ITINERARIO|RIF|PAG|FACTURA|FORMATO|FECHA|RELACIÓN|ENTREGA/i.test(nextLine)) continue
          // The name is typically uppercase, may contain commas and periods
          if (nextLine.length > 2 && nextLine.length < 80) {
            workerName = nextLine
            break
          }
        }
        break
      }
    }

    // ── Extract RIF ──
    let rif = ''
    const rifMatch = block.match(/RIF\s*:\s*([A-Z0-9\-]+)/i)
    if (rifMatch) {
      rif = rifMatch[1].trim().toUpperCase()
    }

    // ── Extract product assignments from the block ──
    const assignments: Array<{ productCode: string; quantity: number }> = []

    for (const line of lines) {
      // Skip header/metadata lines
      if (/^\s*$/.test(line)) continue
      if (/CODIGO|ITINERARIO|RIF|RUTA|ZONA|PAG:|FECHA|SERIE|RELACIÓN|ENTREGA|CRÉDITO|CREDITO|SIN DERECHO|Total Unidades/i.test(line)) continue
      if (/^CANT\./i.test(line)) continue  // Skip the "CANT.   CÓDIGO   DESCRIPCIÓN" header

      // ── KEY: The actual PDF format is: QUANTITY  PRODUCT_CODE  DESCRIPTION ──
      // e.g., " 1       19967   CEFADROXAN 500MG. X10CA"
      // e.g., " 4       17280   COLGATE MAX.PROT AC 90GR"
      // e.g., " 2       GN101   LOSARTAN P.GN50MG. X30"

      // Pattern: Line starts with a number (quantity), then spaces, then a product code
      const productLineMatch = line.match(/^\s*(\d{1,3})\s+([A-Z0-9]{2,10})\s/i)
      if (productLineMatch) {
        const qty = parseInt(productLineMatch[1], 10)
        const potentialCode = productLineMatch[2].toUpperCase()

        if (qty > 0 && qty <= 999 && isValidProductCode(potentialCode, validProductCodes)) {
          assignments.push({
            productCode: potentialCode,
            quantity: qty,
          })
          continue
        }
      }

      // Fallback pattern: Product code at the start of the line (for other PDF formats)
      const codeAtStartMatch = line.match(/^\s*([A-Z0-9]{3,10})\s{2,}/)
      if (codeAtStartMatch) {
        const potentialCode = codeAtStartMatch[1].toUpperCase()
        if (isValidProductCode(potentialCode, validProductCodes)) {
          // Look for quantity at end of line
          const endQtyMatch = line.match(/\s+(\d{1,3})\s*$/)
          const qty = endQtyMatch ? parseInt(endQtyMatch[1], 10) : 1
          if (qty > 0 && qty <= 999) {
            assignments.push({
              productCode: potentialCode,
              quantity: qty,
            })
            continue
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

    // Build a set of valid product codes for PDF matching
    const validProductCodes = new Set(allProducts.map(p => p.code.toUpperCase()))

    // Create products in database
    for (const p of allProducts) {
      try {
        await db.product.upsert({
          where: {
            code_sessionId: { code: p.code, sessionId },
          },
          create: {
            code: p.code,
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
            ocrMethod = ocrResult.method === 'pdftotext' ? 'pdftotext' : 'ocr'
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
            // Find the product - try exact match first, then case-insensitive
            let product = await db.product.findUnique({
              where: { code_sessionId: { code: a.productCode, sessionId } },
            })

            if (!product) {
              const products = await db.product.findMany({
                where: {
                  sessionId,
                  code: { equals: a.productCode },
                },
                take: 1,
              })
              product = products[0] || null
            }

            // Try without leading zeros
            if (!product && /^0+\d+$/.test(a.productCode)) {
              const strippedCode = a.productCode.replace(/^0+/, '')
              product = await db.product.findUnique({
                where: { code_sessionId: { code: strippedCode, sessionId } },
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
                  productCode: a.productCode,
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
