import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET: Get all products for a session with their status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const status = searchParams.get('status') // optional filter by status

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = { sessionId }

    if (status) {
      where.status = status
    }

    const products = await db.product.findMany({
      where,
      orderBy: { code: 'asc' },
    })

    // Compute summary stats
    const summary = {
      total: products.length,
      pending: products.filter((p) => p.status === 'pending').length,
      partial: products.filter((p) => p.status === 'partial').length,
      complete: products.filter((p) => p.status === 'complete').length,
      missing: products.filter((p) => p.status === 'missing').length,
      totalRequested: products.reduce((sum, p) => sum + p.totalRequested, 0),
      totalScanned: products.reduce((sum, p) => sum + p.totalScanned, 0),
    }

    return NextResponse.json({ products, summary })
  } catch (error) {
    console.error('Error getting products:', error)
    return NextResponse.json(
      { error: 'Failed to get products' },
      { status: 500 }
    )
  }
}
