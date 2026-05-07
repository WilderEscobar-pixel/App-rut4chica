import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

function getTodayDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// GET: Get current active/saved session (or create one for today if none exists)
// Also supports ?savedOnly=true to list all saved sessions for the "Reanudar" feature
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // List all saved sessions for the "Reanudar Jornada" feature
    if (searchParams.get('savedOnly') === 'true') {
      const savedSessions = await db.session.findMany({
        where: { status: 'saved' },
        include: {
          _count: {
            select: { products: true, assignments: true, scanEvents: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      })
      return NextResponse.json({ savedSessions })
    }

    // Find active or saved session
    let session = await db.session.findFirst({
      where: { status: { in: ['active', 'saved'] } },
      include: {
        _count: {
          select: { products: true, assignments: true, scanEvents: true },
        },
      },
    })

    // If no active/saved session, find or create one for today
    if (!session) {
      const today = getTodayDate()
      const existingSession = await db.session.findUnique({
        where: { date: today },
      })

      if (existingSession) {
        session = await db.session.update({
          where: { id: existingSession.id },
          data: { status: 'active' },
          include: {
            _count: {
              select: { products: true, assignments: true, scanEvents: true },
            },
          },
        })
      } else {
        session = await db.session.create({
          data: {
            date: today,
            status: 'active',
          },
          include: {
            _count: {
              select: { products: true, assignments: true, scanEvents: true },
            },
          },
        })
      }
    }

    return NextResponse.json({ session })
  } catch (error) {
    console.error('Error getting/creating session:', error)
    return NextResponse.json(
      { error: 'Failed to get or create session' },
      { status: 500 }
    )
  }
}

// POST: Create a new session for today (close any existing active session first)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const date = body.date || getTodayDate()

    // Close any existing active sessions
    await db.session.updateMany({
      where: { status: 'active' },
      data: { status: 'closed' },
    })

    // Check if a session for this date already exists
    const existingSession = await db.session.findUnique({
      where: { date },
    })

    if (existingSession) {
      const session = await db.session.update({
        where: { id: existingSession.id },
        data: { status: 'active' },
        include: {
          _count: {
            select: { products: true, assignments: true, scanEvents: true },
          },
        },
      })
      return NextResponse.json({ session, reactivated: true })
    }

    const session = await db.session.create({
      data: {
        date,
        status: 'active',
      },
      include: {
        _count: {
          select: { products: true, assignments: true, scanEvents: true },
        },
      },
    })

    return NextResponse.json({ session, reactivated: false })
  } catch (error) {
    console.error('Error creating session:', error)
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    )
  }
}

// PUT: Save session (preserve progress, set status to "saved")
// This does NOT mark products as missing — they keep their current status
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const session = await db.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (session.status !== 'active') {
      return NextResponse.json(
        { error: 'Only active sessions can be saved' },
        { status: 400 }
      )
    }

    // Simply change status to "saved" — DO NOT mark products as missing
    const updatedSession = await db.session.update({
      where: { id: sessionId },
      data: { status: 'saved' },
      include: {
        _count: {
          select: { products: true, assignments: true, scanEvents: true },
        },
      },
    })

    // Count pending/partial products for the response
    const pendingCount = await db.product.count({
      where: { sessionId, status: { in: ['pending', 'partial'] } },
    })

    return NextResponse.json({
      success: true,
      message: `Sesión guardada. ${pendingCount} productos pendientes/parciales quedan para reanudar.`,
      session: updatedSession,
      pendingProducts: pendingCount,
    })
  } catch (error) {
    console.error('Error saving session:', error)
    return NextResponse.json(
      { error: 'Failed to save session' },
      { status: 500 }
    )
  }
}

// PATCH: Resume a saved session (set status back to "active")
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const session = await db.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (session.status !== 'saved') {
      return NextResponse.json(
        { error: 'Only saved sessions can be resumed' },
        { status: 400 }
      )
    }

    // Close any other active sessions first (safety)
    await db.session.updateMany({
      where: { status: 'active' },
      data: { status: 'closed' },
    })

    // Reactivate the saved session
    const updatedSession = await db.session.update({
      where: { id: sessionId },
      data: { status: 'active' },
      include: {
        _count: {
          select: { products: true, assignments: true, scanEvents: true },
        },
      },
    })

    // Count what still needs scanning
    const pendingCount = await db.product.count({
      where: { sessionId, status: { in: ['pending', 'partial'] } },
    })

    return NextResponse.json({
      success: true,
      message: `Sesión reanudada. ${pendingCount} productos pendientes por escanear.`,
      session: updatedSession,
      pendingProducts: pendingCount,
    })
  } catch (error) {
    console.error('Error resuming session:', error)
    return NextResponse.json(
      { error: 'Failed to resume session' },
      { status: 500 }
    )
  }
}

// DELETE: "Nueva Jornada" - Reset the session for a fresh start
// This clears all data for the current session so the user can upload new files
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const force = searchParams.get('force') === 'true'

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

    // If session is active/saved and has data, require force flag
    if ((session.status === 'active' || session.status === 'saved') && !force) {
      const productCount = await db.product.count({
        where: { sessionId },
      })
      const scanCount = await db.scanEvent.count({
        where: { sessionId },
      })
      
      if (productCount > 0 || scanCount > 0) {
        return NextResponse.json({
          error: 'Session has data. Use force=true to confirm reset.',
          requiresConfirmation: true,
          productCount,
          scanCount,
        }, { status: 409 })
      }
    }

    // Delete all data for this session (cascade will handle relations)
    // We delete the session and create a fresh one for today
    await db.session.delete({
      where: { id: sessionId },
    })

    // Create a new fresh session for today
    const today = getTodayDate()
    const newSession = await db.session.create({
      data: {
        date: today,
        status: 'active',
      },
      include: {
        _count: {
          select: { products: true, assignments: true, scanEvents: true },
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Sesión reiniciada exitosamente. Puede cargar nuevos archivos.',
      session: newSession,
    })
  } catch (error) {
    console.error('Error resetting session:', error)
    return NextResponse.json(
      { error: 'Failed to reset session' },
      { status: 500 }
    )
  }
}
