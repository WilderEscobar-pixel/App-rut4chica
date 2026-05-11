import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

/**
 * GET /api/debug - Check API health
 * POST /api/debug - Analyze Excel file structure without saving to database
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Debug API active' })
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const workbook = XLSX.read(buffer, { type: 'buffer' })

    const analysis: {
      fileName: string
      fileSize: number
      sheets: Array<{
        name: string
        rowCount: number
        headers: string[]
        sampleRows: Record<string, unknown>[]
        detectedColumns: Record<string, string | null>
        validProductCodeCount: number
        sampleCodes: string[]
      }>
    } = {
      fileName: file.name,
      fileSize: buffer.length,
      sheets: [],
    }

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      const headers = rows.length > 0 ? Object.keys(rows[0]) : []

      // Detect columns
      const codeCol = findColumnStrict(headers, ['CODIGO', 'CÓDIGO', 'CODIGO PRODUCTO', 'COD. PRODUCTO'])
      const descCol = findColumnStrict(headers, ['DESCRIPCION', 'DESCRIPCIÓN', 'DESCRIPCION DEL PRODUCTO', 'DESCRIP. PRODUCTO'])
      const qtyCol = findColumnStrict(headers, ['CANT. SOLICITADA', 'CANTIDAD SOLICITADA', 'CANT SOLICITADA', 'CANTIDAD', 'TOTAL', 'QTY', 'QUANTITY'])
      const bultoCol = findColumnStrict(headers, ['BULTO DESPACHADO', 'BULTO DESP.', 'BULTO', 'PACKAGE'])
      const origenCol = findColumnStrict(headers, ['ORIGEN', 'ORIGIN'])

      // Count valid product codes
      let validCodeCount = 0
      const sampleCodes: string[] = []
      if (codeCol) {
        for (const row of rows) {
          const code = String(row[codeCol] ?? '').trim().toUpperCase()
          if (code && isValidProductCode(code)) {
            validCodeCount++
            if (sampleCodes.length < 20) sampleCodes.push(code)
          }
        }
      }

      analysis.sheets.push({
        name: sheetName,
        rowCount: rows.length,
        headers,
        sampleRows: rows.slice(0, 5),
        detectedColumns: { codeCol, descCol, qtyCol, bultoCol, origenCol },
        validProductCodeCount: validCodeCount,
        sampleCodes,
      })
    }

    return NextResponse.json(analysis)
  } catch (error) {
    console.error('[Debug] Error analyzing file:', error)
    return NextResponse.json(
      { error: 'Failed to analyze file', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

function isValidProductCode(code: string): boolean {
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return false
  const rejectedCodes = new Set([
    'SI', 'NO', 'NA', 'ND', 'NC', 'R', 'G', 'N', 'S',
    'TOTAL', 'SUB', 'SUM', 'PARCIAL', 'GENERAL',
    'REG', 'REGULAR', 'CHEQUEO', 'RUTA', 'CHICA',
    'ORIGEN', 'BULTO', 'COD', 'CODE', 'DESC',
    'CANT', 'QTY', 'UN', 'UNO', 'DOS', 'TRES',
  ])
  if (rejectedCodes.has(code)) return false
  if (/^[A-Z]\d?$/.test(code)) return false
  if (/^[A-Z]/.test(code) && code.length < 3) return false
  if (/^\d+$/.test(code) && code.length < 3) return false
  return true
}

function findColumnStrict(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) =>
    h.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  )
  for (const candidate of candidates) {
    const norm = candidate.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const idx = normalized.indexOf(norm)
    if (idx >= 0) return headers[idx]
    if (norm.split(/\s+/).length >= 2) {
      for (let i = 0; i < normalized.length; i++) {
        if (normalized[i].includes(norm) || norm.includes(normalized[i])) {
          return headers[i]
        }
      }
    }
  }
  return null
}
