---
Task ID: 1
Agent: Main Agent
Task: Fix app processing speed and restore working functionality from backup

Work Log:
- Downloaded and extracted backup app from Google Drive
- Compared backup vs current version - found ROOT CAUSE: current version removed regex-based PDF parsing and made LLM the ONLY method, causing 120+ second processing times
- Restored backup's regex-first PDF parsing as PRIMARY method (instant, no API calls), LLM as fallback only
- Restored backup's simpler Excel parser that reads only the first sheet (avoids multi-sheet product count bug)
- Fixed upload route to allow Excel-only uploads (PDF is now optional)
- Fixed client-side upload panel to not require both Excel and PDF files
- Restored AI chat API route from backup with enhanced worker context support
- Restored AI analyze API route from backup (summary, missing_analysis, worker_performance, recommendations)
- Created new /api/workers API endpoint for searching workers by code, name, or itinerary
- Added WorkerSearchPanel component to sidebar with search by worker code and view all workers dialog
- Enhanced AI chat to automatically load worker context when users ask about workers
- Fixed user badge overlap in header - made compact with tooltip instead of inline name
- Made header more responsive - hide center session info on mobile, reduce gaps
- Fixed SQLite compatibility issue (removed `mode: 'insensitive'` which isn't supported)

Stage Summary:
- ROOT CAUSE: The current version removed regex-based PDF parsing and only used LLM, causing 120+ second processing for large PDFs
- Backup used regex as PRIMARY (instant) with LLM as FALLBACK only when regex fails
- All fixes applied: upload route, Excel parser, AI routes, worker search, user badge overlap
- App should now process files in seconds (regex path) instead of minutes (LLM path)
