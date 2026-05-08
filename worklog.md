---
Task ID: 1
Agent: Main Agent
Task: Fix all broken features - PDF parser, manual scan, total scanned display, hydration error

Work Log:
- Analyzed dev logs and found PDF parser was completely broken: worker codes included garbage text, names defaulted to "Trabajador N", address words (CALLE, VDA, BARRIO) matched as product codes, resulting in 0 assignments for 266 products
- Rewrote parsePdfText() in upload route with: proper worker code extraction (just the code, not the whole line), itinerary extraction (just the number), 50+ address words filter, isValidProductCode() validation function
- Created new LLM-based PDF parser (pdf-parser-llm.ts) using z-ai-web-dev-sdk for intelligent parsing
- Integrated LLM parsing as primary method with regex as fallback, with cross-method merging for best results
- Added manual barcode entry input field in ProductList component with Enter key support and auto-focus
- Added "Total unidades escaneadas" display with progress bar in ProductList header
- Fixed HTML hydration error by adding AlertDialogDescriptionSafe component that renders <div> instead of <p>
- Reset the current session so user can test with new parser
- All changes pass lint check

Stage Summary:
- PDF parser completely rewritten with LLM + improved regex dual approach
- Manual barcode entry input added to product list
- Total scanned units display restored/enhanced
- AlertDialogDescriptionSafe added for hydration fix
- Session reset for testing
