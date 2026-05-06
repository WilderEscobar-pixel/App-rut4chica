import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET: Get assignments, optionally filtered by productCode or workerId
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const productCode = searchParams.get('productCode')
    const workerId = searchParams.get('workerId')
    const status = searchParams.get('status') // optional filter by status

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = { sessionId }

    if (productCode) {
      where.productCode = productCode
    }

    if (workerId) {
      where.workerId = workerId
    }

    if (status) {
      where.status = status
    }

    const assignments = await db.assignment.findMany({
      where,
      include: {
        worker: true,
        product: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ assignments })
  } catch (error) {
    console.error('Error getting assignments:', error)
    return NextResponse.json(
      { error: 'Failed to get assignments' },
      { status: 500 }
    )
  }
}
