import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const PORT = 3003

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ─── Type Definitions ────────────────────────────────────────────────

interface ScanEventData {
  barcode: string
  productCode: string
  workerName?: string
  itinerary?: string
  productDescription?: string
  assignedTo?: string
}

interface ProductUpdatedData {
  code: string
  description: string
  totalScanned: number
  totalRequested: number
  status: string
}

interface SessionUpdatedData {
  sessionId: string
  status: string
  productCount: number
  scannedCount: number
}

interface SessionFinalizedData {
  sessionId: string
  status: string
  closedAt: string
  productCount: number
  scannedCount: number
  missingCount: number
}

// ─── Connection Tracking ─────────────────────────────────────────────

interface ConnectedClient {
  id: string
  connectedAt: Date
  lastPing: Date
}

const connectedClients = new Map<string, ConnectedClient>()

// ─── Helper: Broadcast to all connected clients ──────────────────────

function broadcastToAll(event: string, data: unknown) {
  io.emit(event, data)
  console.log(`[BROADCAST] ${event} -> ${io.sockets.sockets.size} clients`)
}

// ─── Socket Connection Handler ───────────────────────────────────────

io.on('connection', (socket: Socket) => {
  const connectedAt = new Date()
  connectedClients.set(socket.id, {
    id: socket.id,
    connectedAt,
    lastPing: connectedAt,
  })

  console.log(
    `[CONNECT] Client ${socket.id} connected. Total clients: ${connectedClients.size}`
  )

  // Send welcome event with current connection stats
  socket.emit('connected', {
    message: 'Scanner sync service connected',
    socketId: socket.id,
    timestamp: connectedAt.toISOString(),
    activeClients: connectedClients.size,
  })

  // ─── Scan Events ─────────────────────────────────────────────────

  // Listen for scan events from API routes and broadcast to all clients
  socket.on('scan:event', (data: ScanEventData) => {
    console.log(
      `[SCAN] Barcode: ${data.barcode}, Product: ${data.productCode}, Worker: ${data.assignedTo || 'unassigned'}`
    )
    broadcastToAll('scan:event', {
      ...data,
      timestamp: new Date().toISOString(),
    })
  })

  // ─── Product Updates ─────────────────────────────────────────────

  // Listen for product status changes from API routes and broadcast
  socket.on('product:updated', (data: ProductUpdatedData) => {
    console.log(
      `[PRODUCT] Code: ${data.code}, Status: ${data.status}, Scanned: ${data.totalScanned}/${data.totalRequested}`
    )
    broadcastToAll('product:updated', {
      ...data,
      timestamp: new Date().toISOString(),
    })
  })

  // ─── Session Updates ─────────────────────────────────────────────

  // Listen for session state changes and broadcast
  socket.on('session:updated', (data: SessionUpdatedData) => {
    console.log(
      `[SESSION] ID: ${data.sessionId}, Status: ${data.status}, Products: ${data.productCount}, Scanned: ${data.scannedCount}`
    )
    broadcastToAll('session:updated', {
      ...data,
      timestamp: new Date().toISOString(),
    })
  })

  // Listen for session finalization
  socket.on('session:finalized', (data: SessionFinalizedData) => {
    console.log(
      `[SESSION FINALIZED] ID: ${data.sessionId}, Closed: ${data.closedAt}, Products: ${data.productCount}, Missing: ${data.missingCount}`
    )
    broadcastToAll('session:finalized', {
      ...data,
      timestamp: new Date().toISOString(),
    })
  })

  // ─── Heartbeat / Ping ────────────────────────────────────────────

  socket.on('ping', () => {
    const client = connectedClients.get(socket.id)
    if (client) {
      client.lastPing = new Date()
    }
    socket.emit('pong', {
      timestamp: new Date().toISOString(),
      activeClients: connectedClients.size,
    })
  })

  // ─── Disconnect ──────────────────────────────────────────────────

  socket.on('disconnect', (reason) => {
    connectedClients.delete(socket.id)
    console.log(
      `[DISCONNECT] Client ${socket.id} disconnected (${reason}). Total clients: ${connectedClients.size}`
    )
  })

  // ─── Error Handling ──────────────────────────────────────────────

  socket.on('error', (error) => {
    console.error(`[ERROR] Socket ${socket.id} error:`, error.message)
  })
})

// ─── Server Start ────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Scanner sync service running on port ${PORT}`)
  console.log(`   WebSocket path: / (via Caddy gateway with XTransformPort=${PORT})`)
  console.log(`   Events: scan:event, product:updated, session:updated, session:finalized`)
})

// ─── Graceful Shutdown ───────────────────────────────────────────────

function gracefulShutdown(signal: string) {
  console.log(`\n[SHUTDOWN] Received ${signal}, closing server...`)

  // Notify all connected clients about shutdown
  broadcastToAll('server:shutdown', {
    message: 'Server is shutting down',
    timestamp: new Date().toISOString(),
  })

  // Close all connections
  io.disconnectSockets(true)

  httpServer.close(() => {
    console.log('[SHUTDOWN] Server closed successfully')
    process.exit(0)
  })

  // Force close after 5 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced shutdown after timeout')
    process.exit(1)
  }, 5000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
