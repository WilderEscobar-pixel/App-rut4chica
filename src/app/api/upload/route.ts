import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { writeFile, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { processPdfBuffer } from '@/lib/ocr-engine'

// POST: Upload Excel and/or PDF files
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const excelFile = formData.get('excel') as File | null
    const pdfFile = formData.get('pdf') as File | null
    const sessionId = formData.get('sessionId') as string | null

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // Verify session exists
    const session = await db.session.findUnique({
      where: { id: sessionId },
    })
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    const results: {
      productsCreated: number
      workersCreated: number
      workersUpdated: number
      assignmentsCreated: number
      errors: string[]
      ocrMethod?: string
      ocrPages?: number
      ocrConfidence?: number
    } = {
      productsCreated: 0,
      workersCreated: 0,
      workersUpdated: 0,
      assignmentsCreated: 0,
      errors: [],
    }

    // Process Excel file
    if (excelFile) {
      try {
        const excelBuffer = Buffer.from(await excelFile.arrayBuffer())
        const workbook = XLSX.read(excelBuffer, { type: 'buffer' })

        // Look for "Reporte" sheet, fallback to first sheet
        const sheetName = workbook.SheetNames.includes('Reporte')
          ? 'Reporte'
          : workbook.SheetNames[0]

        const sheet = workbook.Sheets[sheetName]
        if (!sheet) {
          results.errors.push(`No sheet found (tried "Reporte" and first sheet)`)
        } else {
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            defval: '',
          })

          // Skip header row (row 0), process data rows
          let dataRows = rows.slice(1)

          // Check if last row is a total row
          if (dataRows.length > 0) {
            const lastRow = dataRows[dataRows.length - 1]
            const lastRowStr = lastRow.join('').toLowerCase()
            if (
              lastRowStr.includes('total') ||
              lastRowStr.includes('suma') ||
              (lastRow[0] === '' && lastRow[1] === '')
            ) {
              dataRows = dataRows.slice(0, -1)
            }
          }

          for (const row of dataRows) {
            const code = String(row[0] ?? '').trim()
            const description = String(row[1] ?? '').trim()
            const totalRequested = parseInt(String(row[2] ?? '0'), 10)
            const bulto = parseInt(String(row[4] ?? '0'), 10)
            const origen = String(row[6] ?? 'R').trim()

            // Skip empty rows
            if (!code || !description) continue
            if (isNaN(totalRequested)) continue

            try {
              await db.product.upsert({
                where: {
                  code_sessionId: { code, sessionId },
                },
                update: {
                  description,
                  totalRequested,
                  bulto,
                  origen,
                },
                create: {
                  code,
                  description,
                  totalRequested,
                  totalScanned: 0,
                  bulto,
                  origen,
                  status: 'pending',
                  sessionId,
                },
              })
              results.productsCreated++
            } catch (err) {
              results.errors.push(
                `Product ${code}: ${err instanceof Error ? err.message : 'Unknown error'}`
              )
            }
          }
        }
      } catch (err) {
        results.errors.push(
          `Excel processing error: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    }

    // Process PDF file with OCR engine
    if (pdfFile) {
      try {
        const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer())
        
        // Use our OCR engine that handles both text and image PDFs
        const ocrResult = await processPdfBuffer(pdfBuffer)
        const text = ocrResult.text

        results.ocrMethod = ocrResult.method
        results.ocrPages = ocrResult.pagesProcessed
        results.ocrConfidence = Math.round(ocrResult.confidence * 100)

        console.log(`[Upload] PDF processed via ${ocrResult.method}, ${ocrResult.pagesProcessed} pages, confidence: ${Math.round(ocrResult.confidence * 100)}%`)

        if (!text || text.trim().length === 0) {
          results.errors.push('PDF: No se pudo extraer texto del archivo. El PDF puede estar vacío o protegido.')
        } else {
          // Parse delivery notes from the extracted text
          const notes = parseDeliveryNotes(text)

          if (notes.length === 0) {
            results.errors.push('PDF: No se encontraron notas de entrega válidas. Verifique que el formato del PDF sea correcto.')
          }

          for (const note of notes) {
            if (!note.codigo) continue

            try {
              // Create or update worker
              const existingWorker = await db.worker.findUnique({
                where: { code: note.codigo },
              })

              let workerId: string

              if (existingWorker) {
                await db.worker.update({
                  where: { id: existingWorker.id },
                  data: {
                    itinerary: note.itinerario || existingWorker.itinerary,
                    rif: note.rif || existingWorker.rif,
                    ...(note.name ? { name: note.name } : {}),
                  },
                })
                workerId = existingWorker.id
                results.workersUpdated++
              } else {
                const newWorker = await db.worker.create({
                  data: {
                    code: note.codigo,
                    name: note.name || `Trabajador ${note.codigo}`,
                    itinerary: note.itinerario || '0',
                    rif: note.rif || '',
                  },
                })
                workerId = newWorker.id
                results.workersCreated++
              }

              // Create assignments for each product in the note
              for (const productLine of note.products) {
                const productCode = productLine.code
                const quantity = productLine.quantity

                if (!productCode || quantity <= 0) continue

                // Find the product in this session
                const product = await db.product.findUnique({
                  where: {
                    code_sessionId: { code: productCode, sessionId },
                  },
                })

                if (!product) {
                  results.errors.push(
                    `Product ${productCode} from worker ${note.codigo} not found in Excel data`
                  )
                  continue
                }

                try {
                  await db.assignment.upsert({
                    where: {
                      workerId_productId_sessionId: {
                        workerId,
                        productId: product.id,
                        sessionId,
                      },
                    },
                    update: {
                      quantity,
                    },
                    create: {
                      workerId,
                      productId: product.id,
                      productCode,
                      quantity,
                      scannedQuantity: 0,
                      sessionId,
                      status: 'pending',
                    },
                  })
                  results.assignmentsCreated++
                } catch (err) {
                  results.errors.push(
                    `Assignment worker=${note.codigo} product=${productCode}: ${err instanceof Error ? err.message : 'Unknown error'}`
                  )
                }
              }
            } catch (err) {
              results.errors.push(
                `Worker ${note.codigo}: ${err instanceof Error ? err.message : 'Unknown error'}`
              )
            }
          }
        }
      } catch (err) {
        results.errors.push(
          `PDF processing error: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    }

    if (!excelFile && !pdfFile) {
      return NextResponse.json(
        { error: 'At least one file (excel or pdf) is required' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Error processing upload:', error)
    return NextResponse.json(
      { error: 'Failed to process upload' },
      { status: 500 }
    )
  }
}

// Parse delivery notes from PDF text
interface ProductLine {
  code: string
  quantity: number
  description: string
}

interface DeliveryNote {
  codigo: string
  itinerario: string
  name: string
  rif: string
  products: ProductLine[]
}

function parseDeliveryNotes(text: string): DeliveryNote[] {
  const notes: DeliveryNote[] = []
  const seenKeys = new Set<string>()

  // Split by "CODIGO:" markers to find individual delivery notes
  const sections = text.split(/(?=CODIGO\s*:)/i)

  for (const section of sections) {
    const note = parseDeliveryNote(section)
    if (note && note.codigo) {
      // Deduplicate: same worker+itinerary may appear multiple times
      const key = `${note.codigo}_${note.itinerario}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        notes.push(note)
      }
    }
  }

  return notes
}

function parseDeliveryNote(text: string): DeliveryNote | null {
  const note: DeliveryNote = {
    codigo: '',
    itinerario: '',
    name: '',
    rif: '',
    products: [],
  }

  // Extract CODIGO - only take the first non-whitespace token after the colon
  const codigoMatch = text.match(/CODIGO\s*:\s*(\S+)/i)
  if (codigoMatch) {
    note.codigo = codigoMatch[1].trim()
  }

  // Extract ITINERARIO
  const itinerarioMatch = text.match(/ITINERARIO\s*:\s*(\d+)/i)
  if (itinerarioMatch) {
    note.itinerario = itinerarioMatch[1].trim()
  }

  // Extract worker name - it's on the line after ITINERARIO
  const lines = text.split(/\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.match(/ITINERARIO/i)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const nameLine = lines[j].trim()
        if (
          nameLine &&
          !nameLine.match(/^(RIF|CANT|CODIGO|DESCRIPCION|TOTAL|ITINERARIO|ORDEN|RELACION|RUTA|PAG|ZONA|Serie|Fecha|Sin Derecho)/i) &&
          !nameLine.match(/^\d+$/)
        ) {
          note.name = nameLine.replace(/,\s*$/, '').trim()
          break
        }
      }
      break
    }
  }

  // Extract RIF
  const rifMatch = text.match(/RIF\s*:\s*([VJEG]\d{6,12})/i)
  if (rifMatch) {
    note.rif = rifMatch[1].trim()
  }

  // Extract product lines
  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim()
    if (!trimmedLine) continue

    // Format 1: All on one line: "1 20585 PREGALIS 150MG. X30CA"
    const singleLineMatch = trimmedLine.match(
      /^(\d+)\s+([A-Za-z]{0,3}\d{3,5}|[A-Z]{2}\d{3}|[A-Za-z]{1,2}\d{3,4})\s+(.+)$/
    )
    if (singleLineMatch) {
      const quantity = parseInt(singleLineMatch[1], 10)
      const code = singleLineMatch[2].trim()
      const description = singleLineMatch[3].trim()
      
      if (quantity > 0 && quantity <= 1000 && isValidProductCode(code)) {
        addProductIfNew(note, code, quantity, description)
      }
      continue
    }

    // Format 2: Quantity on its own line, followed by code on next line, then description
    const qtyMatch = trimmedLine.match(/^(\d{1,3})$/)
    if (qtyMatch) {
      const quantity = parseInt(qtyMatch[1], 10)
      if (quantity > 0 && quantity <= 100) {
        const nextLines: string[] = []
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          const nextLine = lines[j].trim()
          if (nextLine) nextLines.push(nextLine)
        }
        
        if (nextLines.length >= 1 && isValidProductCode(nextLines[0])) {
          const code = nextLines[0]
          const description = nextLines.length > 1 ? nextLines[1] : ''
          addProductIfNew(note, code, quantity, description)
        }
      }
    }
  }

  // Validate with "Total Unidades"
  const totalMatch = text.match(/Total\s+Unidades\s*:\s*(\d+)/i)
  if (totalMatch && note.products.length > 0) {
    const totalUnits = parseInt(totalMatch[1], 10)
    const productTotal = note.products.reduce((sum, p) => sum + p.quantity, 0)
    if (productTotal !== totalUnits) {
      console.warn(
        `Worker ${note.codigo}: parsed total (${productTotal}) != PDF total (${totalUnits})`
      )
    }
  }

  return note.codigo ? note : null
}

function isValidProductCode(code: string): boolean {
  if (code.length < 3 || code.length > 10) return false
  if (!/\d/.test(code)) return false
  const invalid = ['CODIGO', 'ITINERARIO', 'RUTA', 'ZONA', 'PAG', 'RIF', 'CANT', 'TOTAL', 'ORDEN', 'SERIE', 'FECHA']
  if (invalid.includes(code.toUpperCase())) return false
  return true
}

function addProductIfNew(note: DeliveryNote, code: string, quantity: number, description: string) {
  const existing = note.products.find(p => p.code === code)
  if (!existing) {
    note.products.push({ code, quantity, description })
  }
}
