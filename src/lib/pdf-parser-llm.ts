/**
 * LLM-based PDF Parser
 *
 * Uses z-ai-web-dev-sdk to intelligently parse PDF text and extract
 * worker data and product assignments. This serves as the PRIMARY
 * parsing method, with regex-based parsing as a fallback.
 *
 * MUST be used server-side only (z-ai-web-dev-sdk is backend-only).
 */

import ZAI from 'z-ai-web-dev-sdk'

export interface PdfWorker {
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
 * Parse PDF text using LLM to extract worker and assignment data.
 *
 * The LLM is given the raw PDF text (from pdftotext) and a list of
 * valid product codes from the Excel file, then asked to extract
 * structured JSON data.
 */
export async function parsePdfWithLLM(
  text: string,
  productCodes: string[]
): Promise<PdfWorker[]> {
  if (!text || text.trim().length === 0) {
    console.log('[PDF-LLM] Empty text provided, skipping LLM parsing')
    return []
  }

  if (productCodes.length === 0) {
    console.log('[PDF-LLM] No product codes provided, skipping LLM parsing')
    return []
  }

  const zai = await ZAI.create()

  // Split text into chunks of ~12000 chars at page boundaries if too long
  // This keeps the prompt within reasonable size for the LLM
  const MAX_CHARS = 12000
  const chunks = splitTextIntoChunks(text, MAX_CHARS)

  console.log(`[PDF-LLM] Processing ${chunks.length} chunk(s), ${productCodes.length} valid product codes`)

  const allWorkers: PdfWorker[] = []

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx]
    console.log(`[PDF-LLM] Processing chunk ${chunkIdx + 1}/${chunks.length} (${chunk.length} chars)`)

    // Build a condensed product code reference - show first 200 codes and count
    const productCodesPreview = productCodes.length > 200
      ? `${productCodes.slice(0, 200).join(', ')} ... (${productCodes.length} total)`
      : productCodes.join(', ')

    const prompt = `You are a data extraction specialist for Droguería Nena's Ruta Chica invoice system.

The following text was extracted from PDF invoices using pdftotext -layout. Each invoice represents a worker (vendedor) with their assigned products.

LAYOUT NOTES:
- The text preserves visual layout with lots of spaces between columns
- Each invoice starts with a line like: "CODIGO: XXXX      RUTA: CHICA  ZONA: X    ITINERARIO: 123    PAG:1 / 1"
- Worker names may appear after "SEÑORES:", "SEÑOR:", "CLIENTE:", "NOMBRE:", "VENDEDOR:" labels, or on the next line after the CODIGO line
- Product lines typically have: product_code (4-6 digits) ... description ... quantity
- Products may be separated by many spaces due to layout preservation

Extract ALL workers and their product assignments from this text.

Each worker has:
- code: Worker code (just the code, e.g., "477X", "4857", "516X", "B925") - NOT the full line
- name: Worker full name if found (e.g., "MARÍA GARCÍA") - leave empty string if not found
- itinerary: Itinerary number (just the number, e.g., "19", "902") - NOT the full line
- rif: Tax ID if found, otherwise empty string
- assignments: Array of {productCode, quantity} - product codes assigned to this worker

CRITICAL RULES:
1. Worker code = ONLY the alphanumeric code after "CODIGO:", NOT the rest of the line
2. Itinerary = ONLY the number after "ITINERARIO:", NOT "PAG:1 / 1" or other trailing text
3. Product codes are typically 4-6 digit numbers (like "10204", "10680") or codes like "MN076"
4. Do NOT confuse address words with product codes. These are ADDRESSES, not products:
   CALLE, VDA, CARRERA, BARRIO, ZONA, SECTOR, URB, APT, VEREDA, CALLEJON, CARR, LOS,
   POSTAL, URBANIZACION, TRANSVERSAL, DIAGONAL, KRA, CL, DG, TV, AUTOPISTA, AVENIDA,
   GLORIETA, MUNICIPIO, DEPARTAMENTO, PISO, LOCAL, OFICINA, INTERIOR, BLOQUE, TORRE,
   ETAPA, MANZANA, LOTE, CASA, APARTAMENTO, EDIFICIO, PARQUE, PLAZA
5. Each CODIGO: marker starts a new worker's invoice section
6. Product quantities are numbers, typically 1-99
7. Only include assignments for product codes that look like valid product codes (numeric 4-6 digits or known formats)

Valid product codes from the Excel file (use as reference): ${productCodesPreview}

Respond ONLY with a valid JSON array. No markdown, no code fences, no explanation:
[{"code":"477X","name":"MARÍA GARCÍA","itinerary":"19","rif":"","assignments":[{"productCode":"10204","quantity":12}]}]

PDF TEXT (chunk ${chunkIdx + 1}):
${chunk}`

    try {
      const response = await zai.chat.completions.create({
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      })

      const content = response.choices[0]?.message?.content || '[]'
      console.log(`[PDF-LLM] Chunk ${chunkIdx + 1} raw response length: ${content.length}`)

      // Try to parse JSON from the response - handle potential markdown fences
      let jsonStr = content.trim()
      // Strip markdown code fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim()
      }

      // Find JSON array in the response
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          const validWorkers = parsed
            .filter((w: unknown) => {
              if (!w || typeof w !== 'object') return false
              const worker = w as Record<string, unknown>
              return worker.code && typeof worker.code === 'string' && worker.code.trim().length > 0
            })
            .map((w: Record<string, unknown>) => ({
              code: String(w.code || '').trim().toUpperCase(),
              name: String(w.name || '').trim(),
              itinerary: String(w.itinerary || '0').trim(),
              rif: String(w.rif || '').trim(),
              assignments: Array.isArray(w.assignments)
                ? w.assignments
                    .filter((a: unknown) => a && typeof a === 'object')
                    .map((a: Record<string, unknown>) => ({
                      productCode: String(a.productCode || '').trim().toUpperCase(),
                      quantity: Math.max(1, parseInt(String(a.quantity || '1'), 10) || 1),
                    }))
                    .filter((a: { productCode: string; quantity: number }) => a.productCode.length > 0)
                : [],
            })) as PdfWorker[]

          console.log(`[PDF-LLM] Chunk ${chunkIdx + 1}: ${validWorkers.length} workers, ${validWorkers.reduce((s, w) => s + w.assignments.length, 0)} assignments`)

          // Merge with existing workers
          for (const w of validWorkers) {
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
              if (!existing.name && w.name) {
                existing.name = w.name
              }
            } else {
              allWorkers.push({ ...w })
            }
          }
        }
      } else {
        console.warn(`[PDF-LLM] Chunk ${chunkIdx + 1}: No JSON array found in LLM response`)
        console.log(`[PDF-LLM] Response preview: ${content.substring(0, 500)}`)
      }
    } catch (error) {
      console.error(`[PDF-LLM] Error parsing chunk ${chunkIdx + 1}:`, error)
      // Continue to next chunk
    }
  }

  console.log(`[PDF-LLM] Total: ${allWorkers.length} workers, ${allWorkers.reduce((s, w) => s + w.assignments.length, 0)} assignments`)

  return allWorkers
}

/**
 * Split text into chunks at page break boundaries (form feed chars)
 * to avoid sending too much text to the LLM at once.
 */
function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text]
  }

  // Split on form feeds (page breaks from pdftotext)
  const pages = text.split(/\f/).filter(p => p.trim().length > 0)
  const chunks: string[] = []
  let currentChunk = ''

  for (const page of pages) {
    if (currentChunk.length + page.length + 1 > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = page
    } else {
      currentChunk += (currentChunk ? '\n\f\n' : '') + page
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk)
  }

  return chunks.length > 0 ? chunks : [text.substring(0, maxChars)]
}
