import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/workers
 *
 * Search workers by code, name, or itinerary.
 * Also returns their product assignments for the current session.
 *
 * Query params:
 * - search: Search term (matches code, name, or itinerary)
 * - sessionId: Current session ID (to get assignments)
 * - code: Exact worker code lookup
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim()
    const sessionId = searchParams.get('sessionId')?.trim()
    const code = searchParams.get('code')?.trim()

    // If looking up by exact worker code
    if (code) {
      const worker = await db.worker.findUnique({
        where: { code },
        include: {
          assignments: {
            where: sessionId ? { sessionId } : undefined,
            include: {
              product: {
                select: {
                  code: true,
                  description: true,
                  totalRequested: true,
                  totalScanned: true,
                  status: true,
                },
              },
            },
            orderBy: { productCode: 'asc' },
          },
        },
      })

      if (!worker) {
        return NextResponse.json({
          success: false,
          error: `No se encontró trabajador con código "${code}"`,
        }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        worker: {
          id: worker.id,
          code: worker.code,
          name: worker.name,
          itinerary: worker.itinerary,
          rif: worker.rif,
          assignments: worker.assignments.map(a => ({
            id: a.id,
            productCode: a.productCode,
            productName: a.product.description,
            quantity: a.quantity,
            scannedQuantity: a.scannedQuantity,
            pending: Math.max(0, a.quantity - a.scannedQuantity),
            status: a.status,
            productStatus: a.product.status,
          })),
          totalAssigned: worker.assignments.reduce((s, a) => s + a.quantity, 0),
          totalScanned: worker.assignments.reduce((s, a) => s + a.scannedQuantity, 0),
          totalProducts: worker.assignments.length,
          completedProducts: worker.assignments.filter(a => a.status === 'complete').length,
        },
      })
    }

    // Search workers by code, name, or itinerary
    if (search) {
      const workers = await db.worker.findMany({
        where: {
          OR: [
            { code: { contains: search } },
            { name: { contains: search } },
            { itinerary: { contains: search } },
          ],
        },
        include: {
          assignments: {
            where: sessionId ? { sessionId } : undefined,
            select: {
              productCode: true,
              quantity: true,
              scannedQuantity: true,
              status: true,
            },
          },
        },
        take: 50,
        orderBy: { code: 'asc' },
      })

      const results = workers.map(w => ({
        id: w.id,
        code: w.code,
        name: w.name,
        itinerary: w.itinerary,
        rif: w.rif,
        totalProducts: w.assignments.length,
        totalAssigned: w.assignments.reduce((s, a) => s + a.quantity, 0),
        totalScanned: w.assignments.reduce((s, a) => s + a.scannedQuantity, 0),
        completedProducts: w.assignments.filter(a => a.status === 'complete').length,
      }))

      return NextResponse.json({
        success: true,
        workers: results,
        total: results.length,
      })
    }

    // List all workers (with session context if provided)
    const workers = await db.worker.findMany({
      include: {
        assignments: {
          where: sessionId ? { sessionId } : undefined,
          select: {
            productCode: true,
            quantity: true,
            scannedQuantity: true,
            status: true,
          },
        },
      },
      take: 100,
      orderBy: { code: 'asc' },
    })

    const results = workers.map(w => ({
      id: w.id,
      code: w.code,
      name: w.name,
      itinerary: w.itinerary,
      rif: w.rif,
      totalProducts: w.assignments.length,
      totalAssigned: w.assignments.reduce((s, a) => s + a.quantity, 0),
      totalScanned: w.assignments.reduce((s, a) => s + a.scannedQuantity, 0),
      completedProducts: w.assignments.filter(a => a.status === 'complete').length,
    }))

    return NextResponse.json({
      success: true,
      workers: results,
      total: results.length,
    })
  } catch (error) {
    console.error('[Workers API] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Error al buscar trabajadores' },
      { status: 500 }
    )
  }
}
