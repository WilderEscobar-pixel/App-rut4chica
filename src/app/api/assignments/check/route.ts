import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workerCode, productCode, sessionId } = body

    if (!workerCode || !productCode || !sessionId) {
      return NextResponse.json(
        { error: 'workerCode, productCode y sessionId son requeridos' },
        { status: 400 }
      )
    }

    const worker = await db.worker.findUnique({ where: { code: workerCode } })
    if (!worker) {
      return NextResponse.json(
        { success: false, error: `Trabajador "${workerCode}" no encontrado` },
        { status: 404 }
      )
    }

    const product = await db.product.findFirst({
      where: { code: productCode, sessionId },
    })
    if (!product) {
      return NextResponse.json(
        { success: false, error: `Producto "${productCode}" no encontrado en esta sesión` },
        { status: 404 }
      )
    }

    const assignment = await db.assignment.findFirst({
      where: {
        workerId: worker.id,
        productId: product.id,
        sessionId,
      },
    })

    if (!assignment) {
      return NextResponse.json(
        { success: false, error: `El producto "${productCode}" no está asignado al trabajador "${workerCode}"` },
        { status: 404 }
      )
    }

    if (assignment.status === 'complete') {
      return NextResponse.json({
        success: true,
        alreadyComplete: true,
        message: 'Ya estaba completo',
        assignment: {
          id: assignment.id,
          productCode: assignment.productCode,
          workerCode: worker.code,
          workerName: worker.name,
          quantity: assignment.quantity,
          scannedQuantity: assignment.scannedQuantity,
          status: assignment.status,
        },
      })
    }

    const remaining = assignment.quantity - assignment.scannedQuantity

    await db.$transaction([
      db.assignment.update({
        where: { id: assignment.id },
        data: {
          scannedQuantity: assignment.quantity,
          status: 'complete',
        },
      }),
      db.product.update({
        where: { id: product.id },
        data: {
          totalScanned: { increment: remaining },
          status:
            product.totalScanned + remaining >= product.totalRequested
              ? 'complete'
              : 'partial',
        },
      }),
      db.scanEvent.create({
        data: {
          barcode: productCode,
          productCode,
          workerId: worker.id,
          itinerary: worker.itinerary,
          assignedTo: worker.name,
          sessionId,
          quantity: remaining,
        },
      }),
    ])

    const updatedAssignment = await db.assignment.findUnique({
      where: { id: assignment.id },
      select: {
        id: true,
        productCode: true,
        quantity: true,
        scannedQuantity: true,
        status: true,
      },
    })

    const updatedProduct = await db.product.findUnique({
      where: { id: product.id },
      select: {
        totalScanned: true,
        totalRequested: true,
        status: true,
      },
    })

    const allWorkerAssignments = await db.assignment.count({
      where: {
        workerId: worker.id,
        sessionId,
        status: 'complete',
      },
    })

    const totalWorkerAssignments = await db.assignment.count({
      where: {
        workerId: worker.id,
        sessionId,
      },
    })

    const workerComplete = allWorkerAssignments === totalWorkerAssignments

    return NextResponse.json({
      success: true,
      alreadyComplete: false,
      message: `✓ ${remaining} unidad(es) chequeada(s) para ${worker.name}`,
      assignment: updatedAssignment,
      product: updatedProduct,
      workerComplete,
      workerProgress: {
        completed: allWorkerAssignments,
        total: totalWorkerAssignments,
      },
    })
  } catch (error) {
    console.error('[Check Assignment] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Error al marcar producto como completo' },
      { status: 500 }
    )
  }
}
