'use client'

import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'

// ─── Type Definitions ────────────────────────────────────────────────

export interface SessionData {
  id: string
  date: string
  status: string
  createdAt: string
  updatedAt: string
  _count?: {
    products: number
    assignments: number
    scanEvents: number
  }
}

export interface ProductData {
  id: string
  code: string
  description: string
  totalRequested: number
  totalScanned: number
  bulto: number
  origen: string
  status: 'pending' | 'partial' | 'complete' | 'missing'
  sessionId: string
  _count?: {
    assignments: number
  }
}

export interface AssignmentData {
  id: string
  workerId: string
  productId: string
  productCode: string
  quantity: number
  scannedQuantity: number
  status: string
  worker: {
    id: string
    code: string
    name: string
    itinerary: string
    rif: string
  }
  product: {
    code: string
    description: string
  }
}

export interface ScanEventData {
  id: string
  barcode: string
  productCode: string
  workerId: string | null
  itinerary: string | null
  assignedTo: string | null
  sessionId: string
  createdAt: string
}

export interface ScanResult {
  status: 'assigned' | 'already_complete' | 'scanned_unassigned' | 'not_found'
  message: string
  assignment?: {
    id: string
    workerName: string
    workerCode: string
    itinerary: string
    productCode: string
    productDescription: string
    quantity: number
    scannedQuantity: number
    status: string
  }
  product?: {
    code: string
    description: string
    totalRequested: number
    totalScanned: number
    status: string
  }
  otherWorkerProducts?: Array<{
    productCode: string
    productDescription: string
    quantity: number
    scannedQuantity: number
    status: string
  }>
  barcode?: string
}

export interface UploadResult {
  success: boolean
  results: {
    productsCreated: number
    workersCreated: number
    workersUpdated: number
    assignmentsCreated: number
    errors: string[]
    ocrMethod?: string
    ocrPages?: number
    ocrConfidence?: number
  }
}

export interface ReportData {
  summary: {
    sessionDate: string
    sessionStatus: string
    totalProducts: number
    completeProducts: number
    incompleteProducts: number
    pendingProducts: number
    partialProducts: number
    missingProducts: number
    totalRequested: number
    totalScanned: number
    totalMissing: number
    completionPercentage: number
  }
  missingItems: Array<{
    code: string
    description: string
    totalRequested: number
    totalScanned: number
    missing: number
    status: string
    bulto: number
    origen: string
    assignments: Array<{
      workerName: string
      workerCode: string
      itinerary: string
      quantity: number
      scannedQuantity: number
      pending: number
      status: string
    }>
  }>
}

export interface ProductSummary {
  total: number
  pending: number
  partial: number
  complete: number
  missing: number
  totalRequested: number
  totalScanned: number
}

// ─── Store State Interface ───────────────────────────────────────────

interface AppState {
  // Session
  session: SessionData | null
  products: ProductData[]
  productSummary: ProductSummary | null
  scanEvents: ScanEventData[]
  lastScan: ScanResult | null
  report: ReportData | null

  // Assignments cache (by product code)
  assignmentsMap: Record<string, AssignmentData[]>

  // Loading states
  isLoading: boolean
  isUploading: boolean
  isScanning: boolean
  isFinalizing: boolean
  isResetting: boolean

  // OCR processing state
  ocrMethod: string | null
  ocrPages: number | null
  ocrConfidence: number | null

  // Scanner state
  isScannerListening: boolean
  isSocketConnected: boolean

  // Socket
  socket: Socket | null

  // Actions
  fetchSession: () => Promise<void>
  fetchProducts: (filters?: { status?: string; search?: string }) => Promise<void>
  fetchAssignments: (productCode: string) => Promise<void>
  uploadFiles: (excel: File, pdf: File) => Promise<UploadResult | null>
  scanBarcode: (barcode: string) => Promise<ScanResult | null>
  finalizeSession: () => Promise<boolean>
  fetchReport: () => Promise<ReportData | null>
  fetchRecentScans: () => Promise<void>
  resetSession: (force?: boolean) => Promise<boolean>
  setScannerListening: (listening: boolean) => void
  initSocket: () => void
  disconnectSocket: () => void
}

// ─── Zustand Store ───────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  session: null,
  products: [],
  productSummary: null,
  scanEvents: [],
  lastScan: null,
  report: null,
  assignmentsMap: {},
  isLoading: false,
  isUploading: false,
  isScanning: false,
  isFinalizing: false,
  isResetting: false,
  ocrMethod: null,
  ocrPages: null,
  ocrConfidence: null,
  isScannerListening: false,
  isSocketConnected: false,
  socket: null,

  // ─── Session ─────────────────────────────────────────────────────

  fetchSession: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/session')
      const data = await res.json()
      if (data.session) {
        set({ session: data.session })
      }
    } catch (error) {
      console.error('Error fetching session:', error)
    } finally {
      set({ isLoading: false })
    }
  },

  // ─── Products ────────────────────────────────────────────────────

  fetchProducts: async (filters?: { status?: string; search?: string }) => {
    const { session } = get()
    if (!session) return

    try {
      const params = new URLSearchParams({ sessionId: session.id })
      if (filters?.status) params.set('status', filters.status)
      if (filters?.search) params.set('search', filters.search)

      const res = await fetch(`/api/products?${params.toString()}`)
      const data = await res.json()
      if (data.products) {
        set({
          products: data.products,
          productSummary: data.summary || null,
        })
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    }
  },

  // ─── Assignments ─────────────────────────────────────────────────

  fetchAssignments: async (productCode: string) => {
    const { session } = get()
    if (!session) return

    try {
      const params = new URLSearchParams({
        sessionId: session.id,
        productCode,
      })
      const res = await fetch(`/api/assignments?${params.toString()}`)
      const data = await res.json()
      if (data.assignments) {
        set((state) => ({
          assignmentsMap: {
            ...state.assignmentsMap,
            [productCode]: data.assignments,
          },
        }))
      }
    } catch (error) {
      console.error('Error fetching assignments:', error)
    }
  },

  // ─── Upload ──────────────────────────────────────────────────────

  uploadFiles: async (excel: File, pdf: File) => {
    const { session } = get()
    if (!session) return null

    set({ isUploading: true, ocrMethod: null, ocrPages: null, ocrConfidence: null })
    try {
      const formData = new FormData()
      formData.append('excel', excel)
      formData.append('pdf', pdf)
      formData.append('sessionId', session.id)

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (data.success) {
        // Store OCR metadata
        if (data.results?.ocrMethod) {
          set({
            ocrMethod: data.results.ocrMethod,
            ocrPages: data.results.ocrPages ?? null,
            ocrConfidence: data.results.ocrConfidence ?? null,
          })
        }
        // Refresh products after upload
        await get().fetchProducts()
        return data as UploadResult
      }
      return data as UploadResult
    } catch (error) {
      console.error('Error uploading files:', error)
      return null
    } finally {
      set({ isUploading: false })
    }
  },

  // ─── Scan ────────────────────────────────────────────────────────

  scanBarcode: async (barcode: string) => {
    const { session } = get()
    if (!session) return null

    set({ isScanning: true })
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, sessionId: session.id }),
      })
      const data = await res.json()

      set({ lastScan: data as ScanResult })

      // Refresh products to show updated status
      await get().fetchProducts()

      // Refresh recent scans
      await get().fetchRecentScans()

      return data as ScanResult
    } catch (error) {
      console.error('Error scanning barcode:', error)
      return null
    } finally {
      set({ isScanning: false })
    }
  },

  // ─── Recent Scans ────────────────────────────────────────────────

  fetchRecentScans: async () => {
    const { session } = get()
    if (!session) return

    try {
      const params = new URLSearchParams({
        sessionId: session.id,
        limit: '20',
      })
      const res = await fetch(`/api/scan?${params.toString()}`)
      const data = await res.json()
      if (data.scanEvents) {
        set({ scanEvents: data.scanEvents })
      }
    } catch (error) {
      console.error('Error fetching recent scans:', error)
    }
  },

  // ─── Finalize ────────────────────────────────────────────────────

  finalizeSession: async () => {
    const { session } = get()
    if (!session) return false

    set({ isFinalizing: true })
    try {
      const res = await fetch('/api/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      })
      const data = await res.json()

      if (data.success) {
        set({
          session: { ...session, status: 'closed' },
        })
        await get().fetchProducts()
        await get().fetchReport()
        return true
      }
      return false
    } catch (error) {
      console.error('Error finalizing session:', error)
      return false
    } finally {
      set({ isFinalizing: false })
    }
  },

  // ─── Reset Session (Nueva Jornada) ────────────────────────────────

  resetSession: async (force = false) => {
    const { session } = get()
    if (!session) return false

    set({ isResetting: true })
    try {
      const params = new URLSearchParams({ sessionId: session.id })
      if (force) params.set('force', 'true')

      const res = await fetch(`/api/session?${params.toString()}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.success) {
        // Reset all local state
        set({
          session: data.session,
          products: [],
          productSummary: null,
          scanEvents: [],
          lastScan: null,
          report: null,
          assignmentsMap: {},
          ocrMethod: null,
          ocrPages: null,
          ocrConfidence: null,
        })
        return true
      }
      
      // Handle requiresConfirmation case
      if (data.requiresConfirmation) {
        return data.requiresConfirmation as unknown as boolean
      }
      
      return false
    } catch (error) {
      console.error('Error resetting session:', error)
      return false
    } finally {
      set({ isResetting: false })
    }
  },

  // ─── Report ──────────────────────────────────────────────────────

  fetchReport: async () => {
    const { session } = get()
    if (!session) return null

    try {
      const params = new URLSearchParams({ sessionId: session.id })
      const res = await fetch(`/api/report?${params.toString()}`)
      const data = await res.json()
      if (data.summary) {
        set({ report: data as ReportData })
        return data as ReportData
      }
      return null
    } catch (error) {
      console.error('Error fetching report:', error)
      return null
    }
  },

  // ─── Scanner State ───────────────────────────────────────────────

  setScannerListening: (listening: boolean) => {
    set({ isScannerListening: listening })
  },

  // ─── WebSocket ───────────────────────────────────────────────────

  initSocket: () => {
    const existingSocket = get().socket
    if (existingSocket?.connected) return

    const socket = io('/?XTransformPort=3003', {
      path: '/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => {
      console.log('[WS] Connected to scanner sync service')
      set({ isSocketConnected: true })
    })

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected from scanner sync service')
      set({ isSocketConnected: false })
    })

    socket.on('scan:event', (data: ScanEventData & { timestamp: string }) => {
      console.log('[WS] Scan event:', data)
      set((state) => ({
        scanEvents: [
          {
            id: data.id || `ws-${Date.now()}`,
            barcode: data.barcode,
            productCode: data.productCode,
            workerId: data.workerId || null,
            itinerary: data.itinerary || null,
            assignedTo: data.assignedTo || null,
            sessionId: data.sessionId || state.session?.id || '',
            createdAt: data.timestamp || new Date().toISOString(),
          },
          ...state.scanEvents,
        ].slice(0, 20),
      }))
    })

    socket.on('product:updated', () => {
      console.log('[WS] Product updated, refreshing...')
      get().fetchProducts()
    })

    socket.on('session:updated', (data: { sessionId: string; status: string }) => {
      console.log('[WS] Session updated:', data)
      const { session } = get()
      if (session && session.id === data.sessionId) {
        set({ session: { ...session, status: data.status } })
      }
    })

    socket.on('session:finalized', () => {
      console.log('[WS] Session finalized')
      get().fetchProducts()
      get().fetchReport()
    })

    set({ socket })
  },

  disconnectSocket: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({ socket: null, isSocketConnected: false })
    }
  },
}))
