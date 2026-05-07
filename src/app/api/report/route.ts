import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET: Generate final report showing only missing/incomplete products
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    // Get session info
    const session = await db.session.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Get all products that are NOT complete (pending, partial, or missing)
    const incompleteProducts = await db.product.findMany({
      where: {
        sessionId,
        status: { in: ['pending', 'partial', 'missing'] },
      },
      include: {
        assignments: {
          include: {
            worker: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    })

    // Get all products for overall stats
    const allProducts = await db.product.findMany({
      where: { sessionId },
    })

    const summary = {
      sessionDate: session.date,
      sessionStatus: session.status,
      totalProducts: allProducts.length,
      completeProducts: allProducts.filter((p) => p.status === 'complete').length,
      incompleteProducts: incompleteProducts.length,
      pendingProducts: allProducts.filter((p) => p.status === 'pending').length,
      partialProducts: allProducts.filter((p) => p.status === 'partial').length,
      missingProducts: allProducts.filter((p) => p.status === 'missing').length,
      totalRequested: allProducts.reduce((sum, p) => sum + p.totalRequested, 0),
      totalScanned: allProducts.reduce((sum, p) => sum + p.totalScanned, 0),
      totalMissing: allProducts.reduce(
        (sum, p) => sum + Math.max(0, p.totalRequested - p.totalScanned),
        0
      ),
      completionPercentage:
        allProducts.length > 0
          ? Math.round(
              (allProducts.filter((p) => p.status === 'complete').length /
                allProducts.length) *
                100
            )
          : 0,
    }

    // Format incomplete products with their assignment details
    const missingItems = incompleteProducts.map((product) => ({
      code: product.code,
      description: product.description,
      totalRequested: product.totalRequested,
      totalScanned: product.totalScanned,
      missing: product.totalRequested - product.totalScanned,
      status: product.status,
      bulto: product.bulto,
      origen: product.origen,
      assignments: product.assignments.map((a) => ({
        workerName: a.worker.name,
        workerCode: a.worker.code,
        itinerary: a.worker.itinerary,
        quantity: a.quantity,
        scannedQuantity: a.scannedQuantity,
        pending: a.quantity - a.scannedQuantity,
        status: a.status,
      })),
    }))

    return NextResponse.json({
      summary,
      missingItems,
    })
  } catch (error) {
    console.error('Error generating report:', error)
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    )
  }
}
