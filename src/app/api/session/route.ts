import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

function getTodayDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// GET: Get current active session (or create one for today if none exists)
export async function GET() {
  try {
    let session = await db.session.findFirst({
      where: { status: 'active' },
      include: {
        _count: {
          select: { products: true, assignments: true, scanEvents: true },
        },
      },
    })

    // If no active session, find or create one for today
    if (!session) {
      const today = getTodayDate()
      // Check if a session for today already exists (may be closed)
      const existingSession = await db.session.findUnique({
        where: { date: today },
      })

      if (existingSession) {
        // Reactivate the existing session for today
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
        // Create a new session for today
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
      // Re-activate it
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

    // Create new session
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
