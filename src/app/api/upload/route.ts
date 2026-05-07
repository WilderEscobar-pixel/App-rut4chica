import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { processPdfBuffer } from '@/lib/ocr-engine'

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
 * Parse the PDF text to extract worker information and their product assignments.
 *
 * The PDF from "Droguería Nena" Ruta Chica system typically contains multiple invoices,
 * each representing a worker/vendedor with their assigned products.
 *
 * Each invoice block contains:
 * - CODIGO: (worker code)
 * - NOMBRE: / VENDEDOR: (worker name)
 * - ITINERARIO: (itinerary number)
 * - RIF: (tax ID)
 * - A table of products with codes and quantities
 */
function parsePdfText(text: string): PdfWorker[] {
  const workers: PdfWorker[] = []
  const errors: string[] = []

  // Split by form feed (page breaks) or by clear invoice separators
  // The PDF may have multiple invoices separated by page breaks or repeated headers
  const pages = text.split(/\f/).filter(p => p.trim().length > 0)
  const fullText = text

  // Strategy 1: Look for structured blocks with CODIGO: markers
  // Each "invoice" block starts with a header containing worker info
  const invoiceBlocks = fullText.split(/(?=CODIGO\s*:)/i)

  for (const block of invoiceBlocks) {
    if (!block.trim()) continue

    // Extract worker code - look for various patterns
    let workerCode = ''
    const codeMatch = block.match(/CODIGO\s*:\s*([^\n\r]+)/i)
    if (codeMatch) {
      workerCode = codeMatch[1].trim()
      // Clean up the code - remove trailing spaces, dots, etc.
      workerCode = workerCode.replace(/[.\s]+$/, '').trim()
    }

    // Extract worker name
    let workerName = ''
    const nameMatch = block.match(/(?:NOMBRE|VENDEDOR|CLIENTE)\s*:\s*([^\n\r]+)/i)
    if (nameMatch) {
      workerName = nameMatch[1].trim()
    }

    // Extract itinerary
    let itinerary = '0'
    const itMatch = block.match(/ITINERARIO\s*:\s*([^\n\r]+)/i)
    if (itMatch) {
      itinerary = itMatch[1].trim().replace(/[.\s]+$/, '')
    }

    // Extract RIF
    let rif = ''
    const rifMatch = block.match(/RIF\s*:\s*([^\n\r]+)/i)
    if (rifMatch) {
      rif = rifMatch[1].trim()
    }

    if (!workerCode && !workerName) continue

    // Extract product assignments from the block
    // Products are typically listed in a table format:
    // CODE    DESCRIPTION    QUANTITY
    // Or: CODE  QTY  DESCRIPTION
    const assignments: Array<{ productCode: string; quantity: number }> = []

    // Split block into lines and look for product patterns
    const lines = block.split(/\n/)

    for (const line of lines) {
      // Skip header lines
      if (/CODIGO|NOMBRE|ITINERARIO|RIF|VENDEDOR|CLIENTE|FACTURA|FORMATO|FECHA|PAGINA/i.test(line)) continue
      if (/^\s*$/.test(line)) continue

      // Pattern 1: Line starts with a product code (alphanumeric, typically 4-6 chars) followed by quantity
      // e.g., "12194  12  Product Description"
      // e.g., "MN076   5  Product Description"
      const productLineMatch = line.match(/^\s*([A-Z0-9]{3,10})\s+(\d+)\s+(.*)/i)
      if (productLineMatch) {
        const [, pCode, qty, desc] = productLineMatch
        // Verify it looks like a product code (not a worker code, itinerary number, etc.)
        // Product codes are typically numeric or start with letters like MN, FL, etc.
        if (desc.trim().length > 2) {
          assignments.push({
            productCode: pCode.trim(),
            quantity: Math.max(1, parseInt(qty, 10) || 1),
          })
        }
        continue
      }

      // Pattern 2: Code followed by description then quantity at end
      // e.g., "12194  Product Description  12"
      const productLineMatch2 = line.match(/^\s*([A-Z0-9]{3,10})\s+(.+?)\s+(\d+)\s*$/)
      if (productLineMatch2) {
        const [, pCode, desc, qty] = productLineMatch2
        if (desc.trim().length > 2) {
          assignments.push({
            productCode: pCode.trim(),
            quantity: Math.max(1, parseInt(qty, 10) || 1),
          })
        }
        continue
      }

      // Pattern 3: Tab-separated or pipe-separated values
      // e.g., "12194\t12\tProduct Description" or "12194|12|Product Description"
      const sepMatch = line.match(/^\s*([A-Z0-9]{3,10})[\t|]\s*(\d+)[\t|]\s*(.*)/)
      if (sepMatch) {
        const [, pCode, qty, desc] = sepMatch
        if (desc.trim().length > 2) {
          assignments.push({
            productCode: pCode.trim(),
            quantity: Math.max(1, parseInt(qty, 10) || 1),
          })
        }
        continue
      }
    }

    if (workerCode || workerName) {
      workers.push({
        code: workerCode || `W${workers.length + 1}`,
        name: workerName || `Trabajador ${workers.length + 1}`,
        itinerary: itinerary || '0',
        rif: rif || '',
        assignments,
      })
    }
  }

  // Strategy 2: If no workers found, try page-by-page parsing
  // Each page might represent one invoice/worker
  if (workers.length === 0 && pages.length > 1) {
    for (const page of pages) {
      const codeMatch = page.match(/CODIGO\s*:\s*([^\n\r]+)/i)
      const nameMatch = page.match(/(?:NOMBRE|VENDEDOR|CLIENTE)\s*:\s*([^\n\r]+)/i)
      const itMatch = page.match(/ITINERARIO\s*:\s*([^\n\r]+)/i)
      const rifMatch = page.match(/RIF\s*:\s*([^\n\r]+)/i)

      const workerCode = codeMatch ? codeMatch[1].trim().replace(/[.\s]+$/, '') : ''
      const workerName = nameMatch ? nameMatch[1].trim() : ''

      if (!workerCode && !workerName) continue

      const assignments: Array<{ productCode: string; quantity: number }> = []
      const lines = page.split(/\n/)

      for (const line of lines) {
        if (/CODIGO|NOMBRE|ITINERARIO|RIF|VENDEDOR|CLIENTE|FACTURA|FORMATO|FECHA|PAGINA/i.test(line)) continue
        if (/^\s*$/.test(line)) continue

        const m1 = line.match(/^\s*([A-Z0-9]{3,10})\s+(\d+)\s+(.*)/i)
        if (m1 && m1[3].trim().length > 2) {
          assignments.push({ productCode: m1[1].trim(), quantity: Math.max(1, parseInt(m1[2], 10) || 1) })
          continue
        }

        const m2 = line.match(/^\s*([A-Z0-9]{3,10})\s+(.+?)\s+(\d+)\s*$/)
        if (m2 && m2[2].trim().length > 2) {
          assignments.push({ productCode: m2[1].trim(), quantity: Math.max(1, parseInt(m2[3], 10) || 1) })
          continue
        }

        const m3 = line.match(/^\s*([A-Z0-9]{3,10})[\t|]\s*(\d+)[\t|]\s*(.*)/)
        if (m3 && m3[3].trim().length > 2) {
          assignments.push({ productCode: m3[1].trim(), quantity: Math.max(1, parseInt(m3[2], 10) || 1) })
        }
      }

      workers.push({
        code: workerCode || `W${workers.length + 1}`,
        name: workerName || `Trabajador ${workers.length + 1}`,
        itinerary: itMatch ? itMatch[1].trim() : '0',
        rif: rifMatch ? rifMatch[1].trim() : '',
        assignments,
      })
    }
  }

  // Strategy 3: If still no workers, try a more aggressive approach
  // Look for any pattern of CODIGO: followed by data
  if (workers.length === 0) {
    // Try to find worker info in a less structured way
    const allCodeMatches = [...fullText.matchAll(/CODIGO\s*:\s*([^\n\r,;]+)/gi)]
    const allNameMatches = [...fullText.matchAll(/(?:NOMBRE|VENDEDOR)\s*:\s*([^\n\r,;]+)/gi)]
    const allItMatches = [...fullText.matchAll(/ITINERARIO\s*:\s*([^\n\r,;]+)/gi)]

    const count = Math.max(allCodeMatches.length, allNameMatches.length)
    for (let i = 0; i < count; i++) {
      workers.push({
        code: allCodeMatches[i]?.[1]?.trim()?.replace(/[.\s]+$/, '') || `W${i + 1}`,
        name: allNameMatches[i]?.[1]?.trim() || `Trabajador ${i + 1}`,
        itinerary: allItMatches[i]?.[1]?.trim() || '0',
        rif: '',
        assignments: [],
      })
    }
  }

  console.log(`[Upload] Parsed ${workers.length} workers from PDF, ${workers.reduce((s, w) => s + w.assignments.length, 0)} total assignments`)
  for (const w of workers) {
    console.log(`[Upload]   Worker: ${w.name} (Cod: ${w.code}, It: ${w.itinerary}) - ${w.assignments.length} assignments`)
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
    // (Some clients send all files in one field)
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

      for (let i = 0; i < pdfFiles.length; i++) {
        try {
          // Use OCR engine to extract text
          const ocrResult = await processPdfBuffer(pdfFiles[i])
          if (i === 0) {
            ocrMethod = ocrResult.method === 'pdftotext' ? 'pdftotext' : 'ocr'
            ocrPages = ocrResult.pagesProcessed
            ocrConfidence = Math.round(ocrResult.confidence * 100)
          }

          console.log(`[Upload] PDF file ${i + 1}: extracted ${ocrResult.text.length} chars via ${ocrResult.method} (confidence: ${ocrResult.confidence})`)

          const pdfWorkers = parsePdfText(ocrResult.text)
          console.log(`[Upload] PDF file ${i + 1}: ${pdfWorkers.length} workers parsed`)

          // Merge workers: if worker code already exists, merge assignments
          for (const w of pdfWorkers) {
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
            } else {
              allWorkers.push({ ...w })
            }
          }
        } catch (err) {
          const msg = `Error parsing PDF file ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`
          console.error(msg)
          errors.push(msg)
        }
      }

      console.log(`[Upload] Total unique workers from ${pdfFiles.length} PDF file(s): ${allWorkers.length}`)

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
            // Check if this was a new worker or an update
            const existedBefore = allWorkers.indexOf(w) < workersCreated
            if (existedBefore) {
              workersUpdated++
            } else {
              workersCreated++
            }
          }

          // Create assignments for this worker
          for (const a of w.assignments) {
            // Find the product in this session
            const product = await db.product.findUnique({
              where: { code_sessionId: { code: a.productCode, sessionId } },
            })

            if (!product) {
              // Product not found in Excel - skip assignment but don't error
              // This can happen when a worker has a product that's not in the current session's Excel
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
    }

    console.log(`[Upload] Result: ${productsCreated} products, ${workersCreated} workers, ${assignmentsCreated} assignments, ${errors.length} errors`)

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
