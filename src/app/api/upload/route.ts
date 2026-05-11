import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { processPdfBuffer } from '@/lib/ocr-engine'
import { parsePdfWithLLM } from '@/lib/pdf-parser-llm'
import * as XLSX from 'xlsx'

interface ExcelProduct {
  code: string
  description: string
  totalRequested: number
  bulto: number
  origen: string
}

/**
 * Extract product data from an Excel file buffer.
 *
 * Based on the actual Excel format used by Drogueria Nena, the columns are:
 * - CODIGO / CÓDIGO          -> Product code
 * - DESCRIPCION / DESCRIPCIÓN -> Product description
 * - Cant. Solicitada          -> Total requested quantity
 * - Bulto Despachado          -> Bulto (package) number
 * - ORIGEN                    -> Origin (R = Regular, G = Checked)
 *
 * The function tries multiple possible column name variants for robustness.
 */
function parseExcelBuffer(buffer: Buffer): ExcelProduct[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const products: ExcelProduct[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    // Convert sheet to JSON with header row
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    })

    if (rows.length === 0) continue

    // Try to find columns by matching possible header names (case-insensitive)
    const headers = Object.keys(rows[0])
    const codeCol = findColumn(headers, ['CODIGO', 'CÓDIGO', 'CODE', 'COD'])
    const descCol = findColumn(headers, ['DESCRIPCION', 'DESCRIPCIÓN', 'DESCRIPCION DEL PRODUCTO', 'DESCRIPTION', 'DESC'])
    const qtyCol = findColumn(headers, ['CANT. SOLICITADA', 'CANTIDAD', 'TOTAL', 'CANT SOLICITADA', 'CANTIDAD SOLICITADA', 'QTY', 'QUANTITY', 'CANT'])
    const bultoCol = findColumn(headers, ['BULTO DESPACHADO', 'BULTO', 'PACKAGE', 'BULTO DESP.'])
    const origenCol = findColumn(headers, ['ORIGEN', 'ORIGIN', 'O'])

    console.log(`[Excel] Sheet "${sheetName}": ${rows.length} rows, columns mapped: code=${codeCol}, desc=${descCol}, qty=${qtyCol}, bulto=${bultoCol}, origen=${origenCol}`)

    if (!codeCol) {
      console.warn(`[Excel] Sheet "${sheetName}": No product code column found, skipping`)
      continue
    }

    for (const row of rows) {
      const code = String(row[codeCol] ?? '').trim().toUpperCase()
      if (!code) continue

      // Validate that the code looks like a product code (alphanumeric, not just numbers from a different column)
      if (!/^[A-Z0-9]{2,10}$/.test(code)) continue

      const description = descCol ? String(row[descCol] ?? '').trim() : code
      const totalRequested = qtyCol ? parseInt(String(row[qtyCol] ?? '0'), 10) || 0 : 0
      const bulto = bultoCol ? parseInt(String(row[bultoCol] ?? '0'), 10) || 0 : 0
      const origen = origenCol ? String(row[origenCol] ?? 'R').trim().toUpperCase() : 'R'

      // Only include products with a valid requested quantity
      if (totalRequested <= 0) continue

      products.push({
        code,
        description: description || code,
        totalRequested,
        bulto,
        origen: origen || 'R',
      })
    }
  }

  return products
}

/**
 * Find a column name from a list of possible names (case-insensitive, accent-insensitive).
 */
function findColumn(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) =>
    h.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  )
  for (const candidate of candidates) {
    const norm = candidate.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const idx = normalized.indexOf(norm)
    if (idx >= 0) return headers[idx]
  }
  return null
}

/**
 * POST /api/upload
 *
 * Accepts FormData with:
 * - excel / excel_1: Excel files (.xlsx/.xls) — up to 2
 * - pdf / pdf_1: PDF files — up to 2
 * - sessionId: Current session ID
 *
 * Processes Excel files to create Product records, then PDF files to create
 * Worker and Assignment records. Returns UploadResult with counts.
 */
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

  try {
    const formData = await request.formData()
    const sessionId = formData.get('sessionId') as string | null

    if (!sessionId) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['sessionId es requerido'] } },
        { status: 400 }
      )
    }

    // Verify the session exists
    const session = await db.session.findUnique({ where: { id: sessionId } })
    if (!session) {
      return NextResponse.json(
        { success: false, results: { productsCreated: 0, workersCreated: 0, workersUpdated: 0, assignmentsCreated: 0, errors: ['Sesión no encontrada'] } },
        { status: 404 }
      )
    }

    // ─── Step 1: Collect Excel files ──────────────────────────────────
    const excelFiles: { name: string; buffer: Buffer }[] = []
    for (const key of ['excel', 'excel_1']) {
      const file = formData.get(key)
      if (file && file instanceof File) {
        const arrayBuffer = await file.arrayBuffer()
        excelFiles.push({ name: file.name, buffer: Buffer.from(arrayBuffer) })
      }
    }

    // ─── Step 2: Process Excel files → Products ──────────────────────
    if (excelFiles.length > 0) {
      console.log(`[Upload] Processing ${excelFiles.length} Excel file(s)...`)

      // Accumulate products from all Excel files, summing quantities for duplicate codes
      const productMap = new Map<string, ExcelProduct>()

      for (const { name, buffer } of excelFiles) {
        try {
          const products = parseExcelBuffer(buffer)
          console.log(`[Upload] Excel "${name}": ${products.length} products extracted`)

          for (const p of products) {
            const existing = productMap.get(p.code)
            if (existing) {
              // Sum totalRequested if same product appears in multiple files
              existing.totalRequested += p.totalRequested
              // Keep the first non-trivial description
              if (!existing.description || existing.description === existing.code) {
                existing.description = p.description
              }
              // Prefer non-zero bulto
              if (existing.bulto === 0 && p.bulto > 0) {
                existing.bulto = p.bulto
              }
            } else {
              productMap.set(p.code, { ...p })
            }
          }
        } catch (err) {
          const msg = `Error procesando Excel "${name}": ${err instanceof Error ? err.message : String(err)}`
          console.error(`[Upload] ${msg}`)
          errors.push(msg)
        }
      }

      // Upsert products into database
      for (const [code, product] of productMap) {
        try {
          const upserted = await db.product.upsert({
            where: {
              code_sessionId: { code, sessionId },
            },
            update: {
              description: product.description,
              totalRequested: product.totalRequested,
              bulto: product.bulto,
              origen: product.origen,
            },
            create: {
              code: product.code,
              description: product.description,
              totalRequested: product.totalRequested,
              bulto: product.bulto,
              origen: product.origen,
              sessionId,
            },
          })
          // Count only newly created products (createdAt === updatedAt on first create)
          if (upserted.createdAt.getTime() === upserted.updatedAt.getTime()) {
            productsCreated++
          }
        } catch (err) {
          const msg = `Error guardando producto ${code}: ${err instanceof Error ? err.message : String(err)}`
          console.error(`[Upload] ${msg}`)
          errors.push(msg)
        }
      }

      console.log(`[Upload] Products processed: ${productMap.size} unique, ${productsCreated} newly created`)
    }

    // ─── Step 3: Collect PDF files ───────────────────────────────────
    const pdfFiles: { name: string; buffer: Buffer }[] = []
    for (const key of ['pdf', 'pdf_1']) {
      const file = formData.get(key)
      if (file && file instanceof File) {
        const arrayBuffer = await file.arrayBuffer()
        pdfFiles.push({ name: file.name, buffer: Buffer.from(arrayBuffer) })
      }
    }

    // ─── Step 4: Process PDF files → Workers & Assignments ───────────
    if (pdfFiles.length > 0) {
      console.log(`[Upload] Processing ${pdfFiles.length} PDF file(s)...`)

      // Get valid product codes for this session
      const sessionProducts = await db.product.findMany({
        where: { sessionId },
        select: { code: true, id: true },
      })
      const validProductCodes = new Set(sessionProducts.map((p) => p.code))
      const productCodeToId = new Map(sessionProducts.map((p) => [p.code, p.id]))

      console.log(`[Upload] ${validProductCodes.size} valid product codes in session`)

      // Process each PDF
      let combinedOcrText = ''
      let totalOcrPages = 0
      let bestOcrConfidence = 0
      let detectedOcrMethod: string | undefined

      for (const { name, buffer } of pdfFiles) {
        try {
          console.log(`[Upload] Extracting text from PDF "${name}" (${buffer.length} bytes)...`)
          const ocrResult = await processPdfBuffer(buffer)

          console.log(`[Upload] PDF "${name}": method=${ocrResult.method}, pages=${ocrResult.pagesProcessed}, confidence=${ocrResult.confidence}, textLength=${ocrResult.text.length}`)

          combinedOcrText += (combinedOcrText ? '\n\f\n' : '') + ocrResult.text
          totalOcrPages += ocrResult.pagesProcessed
          if (ocrResult.confidence > bestOcrConfidence) {
            bestOcrConfidence = ocrResult.confidence
          }
          detectedOcrMethod = ocrResult.method
        } catch (err) {
          const msg = `Error extrayendo texto del PDF "${name}": ${err instanceof Error ? err.message : String(err)}`
          console.error(`[Upload] ${msg}`)
          errors.push(msg)
        }
      }

      // Set OCR metadata
      ocrMethod = detectedOcrMethod
      ocrPages = totalOcrPages
      ocrConfidence = bestOcrConfidence

      if (combinedOcrText.trim().length > 0 && validProductCodes.size > 0) {
        // Parse combined OCR text with LLM to extract workers and assignments
        console.log('[Upload] Parsing PDF text with LLM...')
        const workers = await parsePdfWithLLM(combinedOcrText, Array.from(validProductCodes))
        console.log(`[Upload] LLM extracted ${workers.length} workers`)

        for (const workerData of workers) {
          try {
            // Upsert worker by code
            const existingWorker = await db.worker.findUnique({
              where: { code: workerData.code },
            })

            let workerId: string

            if (existingWorker) {
              // Update worker if we have better info
              const updateData: Record<string, string> = {}
              if (workerData.name && workerData.name !== existingWorker.name && workerData.name !== `Trabajador ${workerData.code}`) {
                updateData.name = workerData.name
              }
              if (workerData.itinerary && workerData.itinerary !== '0' && workerData.itinerary !== existingWorker.itinerary) {
                updateData.itinerary = workerData.itinerary
              }
              if (workerData.rif && workerData.rif !== existingWorker.rif) {
                updateData.rif = workerData.rif
              }

              if (Object.keys(updateData).length > 0) {
                await db.worker.update({
                  where: { id: existingWorker.id },
                  data: updateData,
                })
                workersUpdated++
              }

              workerId = existingWorker.id
            } else {
              // Create new worker
              const newWorker = await db.worker.create({
                data: {
                  code: workerData.code,
                  name: workerData.name || `Trabajador ${workerData.code}`,
                  itinerary: workerData.itinerary || '0',
                  rif: workerData.rif || '',
                },
              })
              workerId = newWorker.id
              workersCreated++
            }

            // Create assignments for valid product codes only
            for (const assignment of workerData.assignments) {
              if (!validProductCodes.has(assignment.productCode)) {
                continue
              }

              const productId = productCodeToId.get(assignment.productCode)
              if (!productId) continue

              try {
                await db.assignment.upsert({
                  where: {
                    workerId_productId_sessionId: {
                      workerId,
                      productId,
                      sessionId,
                    },
                  },
                  update: {
                    quantity: assignment.quantity,
                  },
                  create: {
                    workerId,
                    productId,
                    productCode: assignment.productCode,
                    quantity: assignment.quantity,
                    sessionId,
                  },
                })
                assignmentsCreated++
              } catch (err) {
                const msg = `Error creando asignación ${workerData.code}→${assignment.productCode}: ${err instanceof Error ? err.message : String(err)}`
                console.error(`[Upload] ${msg}`)
                errors.push(msg)
              }
            }
          } catch (err) {
            const msg = `Error procesando trabajador ${workerData.code}: ${err instanceof Error ? err.message : String(err)}`
            console.error(`[Upload] ${msg}`)
            errors.push(msg)
          }
        }
      } else {
        const reason = combinedOcrText.trim().length === 0 ? 'no se extrajo texto de los PDFs' : 'no hay productos en la sesión (cargue un Excel primero)'
        errors.push(`No se procesaron PDFs: ${reason}`)
      }

      console.log(`[Upload] PDF processing complete: ${workersCreated} new workers, ${workersUpdated} updated, ${assignmentsCreated} assignments`)
    }

    const result = {
      success: errors.length === 0 || productsCreated > 0 || assignmentsCreated > 0,
      results: {
        productsCreated,
        workersCreated,
        workersUpdated,
        assignmentsCreated,
        errors,
        ocrMethod,
        ocrPages,
        ocrConfidence,
      },
    }

    console.log(`[Upload] Complete: ${productsCreated} products, ${workersCreated} workers, ${assignmentsCreated} assignments, ${errors.length} errors`)
    return NextResponse.json(result)
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
