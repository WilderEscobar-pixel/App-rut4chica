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
      row['TOTAL'] || row['Total'] || row['CANTIDAD'] || row['Cantidad'] || row['cantidad'] || row['Quantity'] || row['QTY'] || row['CANT'] || row['Cant'] || 0
    )

    const bulto = Number(
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

// ─── PDF Worker/Assignment Parsing ──────────────────────────────────

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
 * matched as product codes. These appear in address lines within the
 * Droguería Nena invoices.
 */
const ADDRESS_WORDS = new Set([
  // Street types
  'CALLE', 'CARRERA', 'KRA', 'CL', 'DG', 'TV', 'TRANSVERSAL', 'DIAGONAL',
  'AUTOPISTA', 'AVENIDA', 'AV', 'GLORIETA', 'CALLEJON', 'CARR',
  // Location types
  'BARRIO', 'SECTOR', 'ZONA', 'URB', 'URBANIZACION', 'MUNICIPIO',
  'DEPARTAMENTO', 'VEREDA', 'LOCALIDAD', 'CORREGIMIENTO',
  // Building/unit types
  'PISO', 'LOCAL', 'OFICINA', 'INTERIOR', 'BLOQUE', 'TORRE', 'APARTAMENTO',
  'APT', 'APTO', 'EDIFICIO', 'CASA', 'MANZANA', 'LOTE', 'ETAPA',
  // Postal
  'POSTAL',
  // Directional
  'SUR', 'NORTE', 'ESTE', 'OESTE', 'BIS',
  // Misc address
  'VDA', 'VIUDA', 'LOS', 'LAS', 'EL', 'LA', 'DE', 'DEL', 'NO',
  'NUM', 'NUMERO', 'NRO', '#', 'KM', 'LT',
  // Document types that might appear
  'RIF', 'NIT', 'CC', 'CE', 'TI',
])

/**
 * Check if a token looks like a valid product code.
 * Product codes are typically:
 * - 4-6 digit numbers (e.g., "10204", "10680")
 * - 2 letters + 3-4 digits (e.g., "MN076")
 * - Short alphanumeric codes that are NOT address words
 */
function isValidProductCode(token: string, validProductCodes?: Set<string>): boolean {
  const upper = token.toUpperCase().trim()

  // Must have some content
  if (!upper || upper.length < 2 || upper.length > 10) return false

  // Skip address words
  if (ADDRESS_WORDS.has(upper)) return false

  // If we have a set of valid product codes, check against it
  if (validProductCodes && validProductCodes.size > 0) {
    if (validProductCodes.has(upper)) return true
  }

  // Pure numeric codes (4-6 digits)
  if (/^\d{4,6}$/.test(upper)) return true

  // Letter-prefix codes: 1-3 letters followed by 2-4 digits (e.g., MN076, X35)
  if (/^[A-Z]{1,3}\d{2,4}$/.test(upper)) return true

  // Numeric codes with letter suffix (e.g., 477X, 516X) - but these are worker codes, not product codes
  // Worker codes: 3-4 digits + 1-2 letters. We should NOT match these as product codes
  // Product codes don't typically end in X
  if (/^\d+[A-Z]{1,2}$/.test(upper)) return false

  return false
}

/**
 * Parse the PDF text to extract worker information and their product assignments.
 *
 * The PDF from "Droguería Nena" Ruta Chica system typically contains multiple invoices,
 * each representing a worker/vendedor with their assigned products.
 *
 * Key fixes from the broken version:
 * 1. Worker code: Only capture the alphanumeric code, not the whole CODIGO line
 * 2. Itinerary: Only capture the number, not the rest of the line
 * 3. Worker name: Try more patterns including SEÑORES, SEÑOR, CLIENTE
 * 4. Address words: Filter them out from product code matching
 * 5. Product codes: Validate against known product codes and format rules
 */
function parsePdfText(text: string, validProductCodes?: Set<string>): PdfWorker[] {
  const workers: PdfWorker[] = []

  if (!text || text.trim().length === 0) {
    console.log('[PDF-Regex] Empty text provided')
    return []
  }

  console.log(`[PDF-Regex] Starting regex parse, text length: ${text.length}`)
  console.log(`[PDF-Regex] First 500 chars: ${text.substring(0, 500)}`)

  // Split by form feed (page breaks) to get individual invoice pages
  const pages = text.split(/\f/).filter(p => p.trim().length > 0)
  console.log(`[PDF-Regex] Found ${pages.length} pages`)

  // Strategy: Split the full text into invoice blocks at each CODIGO: marker
  // Each block starts with a CODIGO: line and contains one worker's data
  const invoiceBlocks = text.split(/(?=CODIGO\s*:)/i)

  for (const block of invoiceBlocks) {
    if (!block.trim()) continue

    // ── Extract worker code: ONLY the alphanumeric code, not the whole line ──
    let workerCode = ''
    const codeMatch = block.match(/CODIGO\s*:\s*([A-Z0-9]+)/i)
    if (codeMatch) {
      workerCode = codeMatch[1].trim().toUpperCase()
    }

    if (!workerCode) continue // Skip blocks without a worker code

    // ── Extract itinerary: ONLY the number ──
    let itinerary = '0'
    const itMatch = block.match(/ITINERARIO\s*:\s*(\d+)/i)
    if (itMatch) {
      itinerary = itMatch[1].trim()
    }

    // ── Extract worker name: Try multiple patterns ──
    let workerName = ''

    // Pattern 1: Explicitly labeled names
    const labeledNamePatterns = [
      /SEÑORES\s*:\s*([^\n\r]+)/i,
      /SEÑOR\s*:\s*([^\n\r]+)/i,
      /CLIENTE\s*:\s*([^\n\r]+)/i,
      /NOMBRE\s*:\s*([^\n\r]+)/i,
      /VENDEDOR\s*:\s*([^\n\r]+)/i,
    ]

    for (const pattern of labeledNamePatterns) {
      const match = block.match(pattern)
      if (match && match[1].trim().length > 2) {
        workerName = match[1].trim()
        break
      }
    }

    // Pattern 2: If no labeled name found, look for name-like text on the line after CODIGO
    if (!workerName) {
      const lines = block.split(/\n/)
      for (let i = 0; i < lines.length; i++) {
        if (/CODIGO\s*:/i.test(lines[i])) {
          // Check the next few lines for a name-like pattern
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const nextLine = lines[j].trim()
            // Skip empty lines, lines that look like addresses, or lines with too many spaces
            if (!nextLine) continue
            // Skip lines that are clearly metadata or addresses
            if (/RUTA|ZONA|ITINERARIO|RIF|PAG|FACTURA|FORMATO|FECHA/i.test(nextLine)) continue
            if (/CALLE|CARRERA|BARRIO|SECTOR|URB|AVENIDA|CASA|APTO|PISO|BLOQUE|TORRE|ETAPA|MANZANA|LOTE|LOCAL|KM|DIAGONAL|TRANSVERSAL/i.test(nextLine)) continue
            // A name line should have uppercase words and not be too long (not a full address)
            if (/^[A-ZÁÉÍÓÚÑ\s\.]+$/.test(nextLine) && nextLine.length > 3 && nextLine.length < 60) {
              // But skip if it looks like address words
              const words = nextLine.split(/\s+/)
              const nonAddressWords = words.filter(w => !ADDRESS_WORDS.has(w.toUpperCase()))
              if (nonAddressWords.length >= 2) {
                workerName = nextLine.trim()
                break
              }
            }
          }
          break
        }
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
    const lines = block.split(/\n/)

    for (const line of lines) {
      // Skip header/metadata lines
      if (/CODIGO|NOMBRE|ITINERARIO|RIF|VENDEDOR|CLIENTE|FACTURA|FORMATO|FECHA|PAGINA|PAG:|SEÑOR|RUTA|ZONA/i.test(line)) continue
      if (/^\s*$/.test(line)) continue

      // The layout from pdftotext -layout has columns separated by many spaces
      // Product lines typically look like:
      //   "12194                              Product Description                   12"
      //   "MN076                              Another Product                        5"
      // Or the product code at the start, with quantity embedded in the line

      // Pattern 1: Line starts with a valid product code (after optional whitespace)
      // followed by spaces and possibly a description, then a quantity
      // We need to be flexible about the spaces between columns

      // First, try to find a product code at the beginning of the line
      const codeAtStartMatch = line.match(/^\s*([A-Z0-9]{3,10})\s/)
      if (codeAtStartMatch) {
        const potentialCode = codeAtStartMatch[1].toUpperCase()

        if (isValidProductCode(potentialCode, validProductCodes)) {
          // Now find the quantity - typically at the end of the line or near it
          // Look for a number at the end of the line
          const endQtyMatch = line.match(/\s+(\d{1,3})\s*$/)
          if (endQtyMatch) {
            const qty = parseInt(endQtyMatch[1], 10)
            if (qty > 0 && qty <= 999) {
              assignments.push({
                productCode: potentialCode,
                quantity: qty,
              })
              continue
            }
          }

          // Look for quantity separated by multiple spaces somewhere in the line
          // In layout mode, quantities might be in a fixed column position
          const midQtyMatch = line.match(/^\s*[A-Z0-9]{3,10}\s{2,}(?:.+?)\s{2,}(\d{1,3})\s/)
          if (midQtyMatch) {
            const qty = parseInt(midQtyMatch[1], 10)
            if (qty > 0 && qty <= 999) {
              assignments.push({
                productCode: potentialCode,
                quantity: qty,
              })
              continue
            }
          }

          // If we have a valid product code but no quantity, assign quantity 1
          // (some PDFs might have quantity implied)
          // But only if we have valid product codes to match against
          if (validProductCodes && validProductCodes.has(potentialCode)) {
            assignments.push({
              productCode: potentialCode,
              quantity: 1,
            })
            continue
          }
        }
      }

      // Pattern 2: Tab-separated or pipe-separated values
      const sepMatch = line.match(/^\s*([A-Z0-9]{3,10})[\t|]\s*(\d{1,3})[\t|]/)
      if (sepMatch) {
        const potentialCode = sepMatch[1].toUpperCase()
        if (isValidProductCode(potentialCode, validProductCodes)) {
          assignments.push({
            productCode: potentialCode,
            quantity: Math.max(1, parseInt(sepMatch[2], 10) || 1),
          })
          continue
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

  // If no workers found with the block-based approach, try page-by-page
  if (workers.length === 0 && pages.length > 1) {
    console.log('[PDF-Regex] Block parsing found 0 workers, trying page-by-page')

    for (const page of pages) {
      const codeMatch = page.match(/CODIGO\s*:\s*([A-Z0-9]+)/i)
      if (!codeMatch) continue

      const workerCode = codeMatch[1].trim().toUpperCase()

      const itMatch = page.match(/ITINERARIO\s*:\s*(\d+)/i)
      const itinerary = itMatch ? itMatch[1].trim() : '0'

      let workerName = ''
      const namePatterns = [
        /SEÑORES\s*:\s*([^\n\r]+)/i,
        /SEÑOR\s*:\s*([^\n\r]+)/i,
        /CLIENTE\s*:\s*([^\n\r]+)/i,
        /NOMBRE\s*:\s*([^\n\r]+)/i,
        /VENDEDOR\s*:\s*([^\n\r]+)/i,
      ]
      for (const pattern of namePatterns) {
        const match = page.match(pattern)
        if (match && match[1].trim().length > 2) {
          workerName = match[1].trim()
          break
        }
      }

      let rif = ''
      const rifMatch = page.match(/RIF\s*:\s*([A-Z0-9\-]+)/i)
      if (rifMatch) rif = rifMatch[1].trim().toUpperCase()

      const assignments: Array<{ productCode: string; quantity: number }> = []
      const lines = page.split(/\n/)

      for (const line of lines) {
        if (/CODIGO|NOMBRE|ITINERARIO|RIF|VENDEDOR|CLIENTE|FACTURA|FORMATO|FECHA|PAGINA|PAG:|SEÑOR|RUTA|ZONA/i.test(line)) continue
        if (/^\s*$/.test(line)) continue

        const codeAtStart = line.match(/^\s*([A-Z0-9]{3,10})\s/)
        if (codeAtStart) {
          const potentialCode = codeAtStart[1].toUpperCase()
          if (isValidProductCode(potentialCode, validProductCodes)) {
            const endQty = line.match(/\s+(\d{1,3})\s*$/)
            if (endQty) {
              const qty = parseInt(endQty[1], 10)
              if (qty > 0 && qty <= 999) {
                assignments.push({ productCode: potentialCode, quantity: qty })
                continue
              }
            }
            if (validProductCodes && validProductCodes.has(potentialCode)) {
              assignments.push({ productCode: potentialCode, quantity: 1 })
            }
          }
        }
      }

      workers.push({
        code: workerCode,
        name: workerName || `Trabajador ${workerCode}`,
        itinerary,
        rif,
        assignments,
      })
    }
  }

  console.log(`[PDF-Regex] Parsed ${workers.length} workers, ${workers.reduce((s, w) => s + w.assignments.length, 0)} total assignments`)
  for (const w of workers) {
    if (w.assignments.length > 0) {
      console.log(`[PDF-Regex]   Worker: ${w.name} (Cod: ${w.code}, It: ${w.itinerary}) - ${w.assignments.length} assignments`)
      for (const a of w.assignments) {
        console.log(`[PDF-Regex]     -> ${a.productCode} x${a.quantity}`)
      }
    }
  }

  return workers
}

// ─── Main Upload Handler ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const sessionId = formData.get('sessionId') as string

    if (!sessionId) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['sessionId is required'] } },
        { status: 400 }
      )
    }

    // Verify session exists
    const session = await db.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['Session not found'] } },
        { status: 404 }
      )
    }

    const errors: string[] = []
    let productsCreated = 0
    let workersCreated = 0
    let workersUpdated = 0
    let assignmentsCreated = 0
    let ocrMethod: string | undefined
    let ocrPages: number | undefined
    let ocrConfidence: number | undefined
    let parsingMethod: string | undefined

    // ─── Process Excel files ─────────────────────────────────────────
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

    // Parse all Excel files and merge products
    const allProducts: ExcelProduct[] = []
    for (let i = 0; i < excelFiles.length; i++) {
      try {
        const products = await parseExcelFile(excelFiles[i])
        console.log(`[Upload] Excel file ${i + 1}: ${products.length} products parsed`)
        // Merge: if product code already exists, sum quantities
        for (const p of products) {
          const existing = allProducts.find(ep => ep.code === p.code)
          if (existing) {
            existing.totalRequested += p.totalRequested
          } else {
            allProducts.push({ ...p })
          }
        }
      } catch (err) {
        const msg = `Error parsing Excel file ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`
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
        errors.push(`Error creating product ${p.code}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // ─── Process PDF files ───────────────────────────────────────────
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

    // Also check for multiple files in a single 'pdf' field
    const allPdfEntries = [...formData.getAll('pdf')].filter(f => f instanceof File) as File[]
    for (const file of allPdfEntries) {
      if (!pdfFiles.some(buf => buf.length === (file as File).size)) {
        pdfFiles.push(Buffer.from(await file.arrayBuffer()))
      }
    }

    if (pdfFiles.length === 0) {
      // No PDF files - just create products without assignments
      console.log('[Upload] No PDF files provided, skipping worker/assignment creation')
    } else {
      // Parse all PDF files and merge workers
      const allWorkers: PdfWorker[] = []
      const allPdfTexts: string[] = []

      // First, extract text from all PDFs
      for (let i = 0; i < pdfFiles.length; i++) {
        try {
          const ocrResult = await processPdfBuffer(pdfFiles[i])
          if (i === 0) {
            ocrMethod = ocrResult.method === 'pdftotext' ? 'pdftotext' : 'ocr'
            ocrPages = ocrResult.pagesProcessed
            ocrConfidence = Math.round(ocrResult.confidence * 100)
          }

          console.log(`[Upload] PDF file ${i + 1}: extracted ${ocrResult.text.length} chars via ${ocrResult.method} (confidence: ${ocrResult.confidence})`)
          console.log(`[Upload] PDF file ${i + 1} first 1000 chars: ${ocrResult.text.substring(0, 1000)}`)

          allPdfTexts.push(ocrResult.text)
        } catch (err) {
          const msg = `Error extracting text from PDF file ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`
          console.error(msg)
          errors.push(msg)
        }
      }

      // Combine all PDF texts for parsing
      const combinedText = allPdfTexts.join('\n\f\n')
      const productCodeList = Array.from(validProductCodes)

      // ── Step 1: Try LLM-based parsing (PRIMARY method) ──
      let llmWorkers: PdfWorker[] = []
      try {
        console.log('[Upload] Attempting LLM-based PDF parsing (primary method)...')
        llmWorkers = await parsePdfWithLLM(combinedText, productCodeList)
        console.log(`[Upload] LLM parsing result: ${llmWorkers.length} workers, ${llmWorkers.reduce((s, w) => s + w.assignments.length, 0)} assignments`)
      } catch (err) {
        console.error('[Upload] LLM parsing failed:', err)
        errors.push(`LLM parsing error: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }

      // ── Step 2: Try regex-based parsing (FALLBACK method) ──
      let regexWorkers: PdfWorker[] = []
      try {
        console.log('[Upload] Attempting regex-based PDF parsing (fallback method)...')
        regexWorkers = parsePdfText(combinedText, validProductCodes)
        console.log(`[Upload] Regex parsing result: ${regexWorkers.length} workers, ${regexWorkers.reduce((s, w) => s + w.assignments.length, 0)} assignments`)
      } catch (err) {
        console.error('[Upload] Regex parsing failed:', err)
      }

      // ── Step 3: Choose the best result ──
      const llmAssignmentCount = llmWorkers.reduce((s, w) => s + w.assignments.length, 0)
      const regexAssignmentCount = regexWorkers.reduce((s, w) => s + w.assignments.length, 0)

      // Also check how many LLM assignments match valid product codes
      const llmValidAssignments = llmWorkers.reduce((s, w) =>
        s + w.assignments.filter(a => validProductCodes.has(a.productCode.toUpperCase())).length, 0)
      const regexValidAssignments = regexWorkers.reduce((s, w) =>
        s + w.assignments.filter(a => validProductCodes.has(a.productCode.toUpperCase())).length, 0)

      console.log(`[Upload] LLM: ${llmWorkers.length} workers, ${llmAssignmentCount} total assignments, ${llmValidAssignments} valid assignments`)
      console.log(`[Upload] Regex: ${regexWorkers.length} workers, ${regexAssignmentCount} total assignments, ${regexValidAssignments} valid assignments`)

      let selectedWorkers: PdfWorker[]

      if (llmValidAssignments > 0 && llmValidAssignments >= regexValidAssignments) {
        // LLM parsing found valid assignments and is at least as good as regex
        selectedWorkers = llmWorkers
        parsingMethod = 'llm'
        console.log(`[Upload] Using LLM parsing (better results)`)
      } else if (regexValidAssignments > 0) {
        // Regex found more valid assignments
        selectedWorkers = regexWorkers
        parsingMethod = 'regex'
        console.log(`[Upload] Using regex parsing (better results)`)
      } else if (llmWorkers.length > 0 && regexWorkers.length === 0) {
        // LLM at least found workers even if no valid assignments
        selectedWorkers = llmWorkers
        parsingMethod = 'llm'
        console.log(`[Upload] Using LLM parsing (only method that found workers)`)
      } else {
        // Use whichever found more data
        selectedWorkers = regexWorkers.length >= llmWorkers.length ? regexWorkers : llmWorkers
        parsingMethod = regexWorkers.length >= llmWorkers.length ? 'regex' : 'llm'
        console.log(`[Upload] Using ${parsingMethod} parsing (fallback decision)`)
      }

      // ── Step 4: Merge workers from the non-selected method if it found different workers ──
      // If one method found workers the other didn't, merge them in
      const otherWorkers = parsingMethod === 'llm' ? regexWorkers : llmWorkers
      for (const ow of otherWorkers) {
        const existing = selectedWorkers.find(sw => sw.code === ow.code)
        if (!existing) {
          // This worker was only found by the other method - add them
          selectedWorkers.push({ ...ow })
          console.log(`[Upload] Adding worker ${ow.code} from ${parsingMethod === 'llm' ? 'regex' : 'LLM'} (not found by primary method)`)
        } else if (existing.assignments.length === 0 && ow.assignments.length > 0) {
          // The selected method found this worker but with no assignments, the other found assignments
          existing.assignments = ow.assignments
          console.log(`[Upload] Using assignments for worker ${ow.code} from ${parsingMethod === 'llm' ? 'regex' : 'LLM'} (primary had 0)`)
        } else if (!existing.name || existing.name.startsWith('Trabajador')) {
          // The selected method didn't find a name, use the other method's name if available
          if (ow.name && !ow.name.startsWith('Trabajador')) {
            existing.name = ow.name
          }
        }
      }

      // Merge into allWorkers (for cross-PDF-file deduplication)
      for (const w of selectedWorkers) {
        const existing = allWorkers.find(ew => ew.code === w.code)
        if (existing) {
          // Merge assignments, summing quantities for same product codes
          for (const a of w.assignments) {
            const existingAssignment = existing.assignments.find(ea => ea.productCode === a.productCode)
            if (existingAssignment) {
              existingAssignment.quantity += a.quantity
            } else {
              existing.assignments.push({ ...a })
            }
          }
          // Update name if we now have one and didn't before
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
          // Upsert worker
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
            const existedBefore = allWorkers.indexOf(w) < workersCreated
            if (existedBefore) {
              workersUpdated++
            } else {
              workersCreated++
            }
          }

          // Create assignments for this worker
          for (const a of w.assignments) {
            // Find the product in this session - try case-insensitive match
            let product = await db.product.findUnique({
              where: { code_sessionId: { code: a.productCode, sessionId } },
            })

            // Fallback: try case-insensitive search
            if (!product) {
              const products = await db.product.findMany({
                where: {
                  sessionId,
                  code: { equals: a.productCode, mode: 'insensitive' },
                },
                take: 1,
              })
              product = products[0] || null
            }

            // Fallback: try without leading zeros
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

            // Create or update assignment
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
              errors.push(`Error creating assignment ${w.code}->${a.productCode}: ${assignErr instanceof Error ? assignErr.message : 'Unknown'}`)
            }
          }
        } catch (workerErr) {
          errors.push(`Error creating worker ${w.code}: ${workerErr instanceof Error ? workerErr.message : 'Unknown'}`)
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
      success: errors.length === 0 || productsCreated > 0,
      results: result,
    })
  } catch (error) {
    console.error('Error in upload:', error)
    return NextResponse.json(
      {
        success: false,
        results: {
          productsCreated: 0,
          workersCreated: 0,
          workersUpdated: 0,
          assignmentsCreated: 0,
          errors: [`Error interno del servidor: ${error instanceof Error ? error.message : 'Unknown error'}`],
        },
      },
      { status: 500 }
    )
  }
}
