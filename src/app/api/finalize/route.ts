import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// POST: Close the session, mark all pending/partial products as "missing"
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // Verify session exists and is active
    const session = await db.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    if (session.status !== 'active' && session.status !== 'saved') {
      return NextResponse.json(
        { error: 'Session must be active or saved to finalize' },
        { status: 400 }
      )
    }

    // Use transaction to ensure atomicity
    const result = await db.$transaction(async (tx) => {
      // Mark all pending products as missing
      const pendingUpdate = await tx.product.updateMany({
        where: {
          sessionId,
          status: 'pending',
        },
        data: { status: 'missing' },
      })

      // Mark all partial products as missing
      const partialUpdate = await tx.product.updateMany({
        where: {
          sessionId,
          status: 'partial',
        },
        data: { status: 'missing' },
      })

      // Close the session
      const updatedSession = await tx.session.update({
        where: { id: sessionId },
        data: { status: 'closed' },
      })

      return {
        session: updatedSession,
        productsMarkedMissing: pendingUpdate.count + partialUpdate.count,
        pendingMarked: pendingUpdate.count,
        partialMarked: partialUpdate.count,
      }
    })

    return NextResponse.json({
      success: true,
      message: `Session closed. ${result.productsMarkedMissing} products marked as missing.`,
      ...result,
    })
  } catch (error) {
    console.error('Error finalizing session:', error)
    return NextResponse.json(
      { error: 'Failed to finalize session' },
      { status: 500 }
    )
  }
}
