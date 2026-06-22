/**
 * OCR Engine for PDF Processing
 * 
 * Strategy:
 * 1. First attempt: pdftotext (fast, for text-based PDFs)
 * 2. Fallback: pdftoppm + tesseract OCR (for image-based PDFs)
 * 
 * This ensures both text PDFs and scanned/image PDFs are handled correctly.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile, mkdir } from 'fs/promises'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

export interface OcrResult {
  text: string
  method: 'pdftotext' | 'ocr'
  pagesProcessed: number
  confidence: number
}

/**
 * Extract text from a PDF file using a two-stage approach:
 * 1. Try pdftotext first (fast)
 * 2. If insufficient data, fall back to OCR via pdftoppm + tesseract
 */
export async function extractTextFromPdf(pdfPath: string): Promise<OcrResult> {
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
 * Process an uploaded PDF Buffer directly
 * Saves to temp file, processes, and returns extracted text
 */
export async function processPdfBuffer(pdfBuffer: Buffer): Promise<OcrResult> {
  const tmpPdf = path.join(os.tmpdir(), `upload_pdf_${Date.now()}.pdf`)
  
  try {
    await writeFile(tmpPdf, pdfBuffer)
    return await extractTextFromPdf(tmpPdf)
  } finally {
    await unlink(tmpPdf).catch(() => {})
  }
}
