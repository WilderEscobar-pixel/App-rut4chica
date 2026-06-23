/**
 * OCR Engine for PDF Processing
 * 
 * Strategy:
 * 1. Primary: pdf-parse (best line/tab preservation)
 * 2. Fallback: pdfjs-dist directly (pure JS, no wrapper)
 * 3. Final fallback: pdftotext + OCR (system tools, Linux/Mac only)
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile, mkdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const execFileAsync = promisify(execFile)
// Node.js require for CJS modules (avoids ESM/CJS interop issues in standalone builds)
const nodeRequire = createRequire(import.meta.url)

export interface OcrResult {
  text: string
  method: 'pdf-parse' | 'pdfjs' | 'pdftotext' | 'ocr'
  pagesProcessed: number
  confidence: number
}

/**
 * Load pdf-parse dynamically — tries ESM import first, falls back to CJS require.
 * This avoids static import issues in Next.js standalone production builds.
 */
async function loadPdfParse(): Promise<{
  PDFParse: new (opts: { data: Buffer; verbosity: number }) => {
    getText(): Promise<{ text: string }>
    getInfo(): Promise<{ total: number }>
    destroy(): Promise<void>
  }
  VerbosityLevel: { ERRORS: number }
}> {
  // Strategy 1: ESM dynamic import (works in dev/Turbopack/regular Node.js)
  try {
    const mod = await import('pdf-parse')
    if (mod.PDFParse) return mod as unknown as ReturnType<typeof loadPdfParse>
  } catch { /* fall through */ }

  // Strategy 2: CJS require via createRequire (works in standalone builds)
  try {
    const mod = nodeRequire('pdf-parse') as Record<string, unknown>
    if (mod.PDFParse) return mod as unknown as ReturnType<typeof loadPdfParse>
  } catch { /* fall through */ }

  throw new Error('pdf-parse not available via import or require')
}

/**
 * Extract text using pdf-parse (PDFParse class) — best line/tab preservation.
 */
async function extractWithPdfParse(pdfBuffer: Buffer): Promise<OcrResult> {
  const { PDFParse, VerbosityLevel } = await loadPdfParse()
  const parser = new PDFParse({ data: pdfBuffer, verbosity: VerbosityLevel.ERRORS })
  const textResult = await parser.getText()
  const infoResult = await parser.getInfo()
  await parser.destroy()
  
  return {
    text: textResult.text || '',
    method: 'pdf-parse',
    pagesProcessed: infoResult.total || 1,
    confidence: 0.9,
  }
}

/**
 * Fallback: pdfjs-dist directly (no wrapper, works everywhere).
 * NOTE: text items are space-joined, not tab-separated.
 */
async function extractWithPdfjs(pdfBuffer: Buffer): Promise<OcrResult> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) })
  const doc = await loadingTask.promise
  
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = (textContent.items as Array<{ str: string }>)
      .map((item) => item.str)
      .join(' ')
    pages.push(pageText)
  }
  
  const text = pages.map((t, i) => `-- ${i + 1} of ${doc.numPages} --\n${t}`).join('\n\n')
  
  return {
    text,
    method: 'pdfjs',
    pagesProcessed: doc.numPages,
    confidence: 0.85,
  }
}

/**
 * Extract text from a PDF file (pdftotext + OCR fallback only).
 * Called by processPdfBuffer after pdf-parse didn't yield enough data.
 */
async function extractTextFromPdfFile(pdfPath: string): Promise<OcrResult> {
  // Stage 1: pdftotext (fast on Linux/Mac)
  try {
    const pdftotextResult = await tryPdftotext(pdfPath)
    const hasCodigoMarkers = /CODIGO\s*:/i.test(pdftotextResult.text)
    const hasItinerarioMarkers = /ITINERARIO\s*:/i.test(pdftotextResult.text)
    const hasEnoughContent = pdftotextResult.text.length > 200 && 
      (hasCodigoMarkers || hasItinerarioMarkers)

    if (hasEnoughContent) {
      return {
        text: pdftotextResult.text,
        method: 'pdftotext',
        pagesProcessed: pdftotextResult.pages,
        confidence: 0.95,
      }
    }

    console.log('[OCR] pdftotext yielded insufficient data, falling back to OCR...')
    return await tryOcrFallback(pdfPath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      console.warn('[OCR] OCR tools not installed — cannot extract PDF text')
      return { text: '', method: 'ocr', pagesProcessed: 0, confidence: 0 }
    }
    throw err
  }
}

/**
 * Extract text using pdftotext CLI
 */
async function tryPdftotext(pdfPath: string): Promise<{ text: string; pages: number }> {
  const tmpTxt = path.join(os.tmpdir(), `pdftotext_${Date.now()}.txt`)
  
  try {
    await execFileAsync('pdftotext', ['-layout', pdfPath, tmpTxt])
    const text = await readFile(tmpTxt, 'utf-8')
    const pages = (text.match(/\f/g) || []).length + 1
    return { text, pages }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      console.warn('[OCR] pdftotext not installed — skipping PDF text extraction')
      return { text: '', pages: 0 }
    }
    throw err
  } finally {
    await unlink(tmpTxt).catch(() => {})
  }
}

/**
 * Fallback OCR using pdftoppm to convert PDF to images, then tesseract for OCR
 */
async function tryOcrFallback(pdfPath: string): Promise<OcrResult> {
  const tmpDir = path.join(os.tmpdir(), `ocr_${Date.now()}`)
  
  try {
    await mkdir(tmpDir, { recursive: true })
    
    // Step 1: Convert PDF pages to PNG images using pdftoppm
    const prefix = path.join(tmpDir, 'page')
    await execFileAsync('pdftoppm', [
      '-png',          // Output format: PNG
      '-r', '300',     // Resolution: 300 DPI (good for OCR)
      '-gray',         // Grayscale (faster, better for OCR)
      pdfPath,
      prefix,
    ])
    
    // Step 2: Find all generated PNG files
    const { readdir } = await import('fs/promises')
    const files = await readdir(tmpDir)
    const pngFiles = files
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.join(tmpDir, f))
    
    if (pngFiles.length === 0) {
      return {
        text: '',
        method: 'ocr',
        pagesProcessed: 0,
        confidence: 0,
      }
    }
    
    console.log(`[OCR] Processing ${pngFiles.length} pages via tesseract...`)
    
    // Step 3: Run tesseract on each page and combine results
    const pageTexts: string[] = []
    let totalConfidence = 0
    
    for (let i = 0; i < pngFiles.length; i++) {
      const pngPath = pngFiles[i]
      const outBase = path.join(tmpDir, `ocr_page_${i}`)
      
      try {
        // Run tesseract with Spanish+English language support
        // Use --psm 6 for uniform block of text (good for structured documents)
        await execFileAsync('tesseract', [
          pngPath,
          outBase,
          '-l', 'eng',     // Language: English (Spanish pack not available)
          '--psm', '6',     // Page segmentation mode: uniform block
          'quiet',          // Suppress verbose output
        ])
        
        const pageText = await readFile(`${outBase}.txt`, 'utf-8')
        pageTexts.push(pageText)
        
        // Get confidence from tesseract output
        try {
          const { stdout } = await execFileAsync('tesseract', [
            pngPath,
            'stdout',
            '-l', 'eng',
            '--psm', '6',
            '--oem', '1',    // LSTM engine only
          ])
          // Simple confidence heuristic: if text is not empty, give moderate confidence
          if (stdout.trim().length > 50) {
            totalConfidence += 0.7
          } else {
            totalConfidence += 0.3
          }
        } catch {
          totalConfidence += 0.5
        }
      } catch (err) {
        console.warn(`[OCR] Error processing page ${i + 1}:`, err)
        pageTexts.push('')
      }
    }
    
    const fullText = pageTexts.join('\n\f\n') // Form feed between pages
    const avgConfidence = pngFiles.length > 0 ? totalConfidence / pngFiles.length : 0
    
    return {
      text: fullText,
      method: 'ocr',
      pagesProcessed: pngFiles.length,
      confidence: avgConfidence,
    }
  } finally {
    // Clean up temp directory
    const { rm } = await import('fs/promises')
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Process an uploaded PDF Buffer directly.
 * Primary: pdf-parse (best formatting). Fallback: pdfjs-dist → system tools.
 */
export async function processPdfBuffer(pdfBuffer: Buffer): Promise<OcrResult> {
  console.log(`[OCR] processPdfBuffer called, buffer size: ${pdfBuffer.length} bytes`)

  // Stage 1: pdf-parse (best text preservation with tabs and line breaks)
  try {
    const result = await extractWithPdfParse(pdfBuffer)
    console.log(`[OCR] pdf-parse SUCCESS: ${result.text.length} chars, ${result.pagesProcessed} pages`)
    if (result.text.length > 200) {
      return result
    }
    console.log('[OCR] pdf-parse returned very little text, trying pdfjs-dist...')
  } catch (err) {
    console.warn('[OCR] pdf-parse failed, trying pdfjs-dist:', err instanceof Error ? err.message : String(err))
  }

  // Stage 2: pdfjs-dist directly (pure JS, no wrapper)
  try {
    const result = await extractWithPdfjs(pdfBuffer)
    console.log(`[OCR] pdfjs SUCCESS: ${result.text.length} chars, ${result.pagesProcessed} pages`)
    if (result.text.length > 200) {
      return result
    }
    console.log('[OCR] pdfjs returned very little text, trying pdftotext...')
  } catch (err) {
    console.warn('[OCR] pdfjs failed, trying pdftotext:', err instanceof Error ? err.message : String(err))
  }

  // Stage 3: pdftotext / OCR (need temp file)
  console.log('[OCR] Falling back to pdftotext/OCR (temp file approach)')
  const tmpPdf = path.join(os.tmpdir(), `upload_pdf_${Date.now()}.pdf`)
  try {
    await writeFile(tmpPdf, pdfBuffer)
    const result = await extractTextFromPdfFile(tmpPdf)
    console.log(`[OCR] pdftotext/OCR result: ${result.text.length} chars via ${result.method}`)
    return result
  } finally {
    await unlink(tmpPdf).catch(() => {})
  }
}
