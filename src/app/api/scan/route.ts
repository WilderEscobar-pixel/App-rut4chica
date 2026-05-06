import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET: Get recent scan events for a session
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const scanEvents = await db.scanEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ scanEvents })
  } catch (error) {
    console.error('Error getting scan events:', error)
    return NextResponse.json(
      { error: 'Failed to get scan events' },
      { status: 500 }
    )
  }
}

// POST: Record a barcode scan with auto-assignment algorithm
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { barcode, sessionId } = body

    if (!barcode || !sessionId) {
      return NextResponse.json(
        { error: 'barcode and sessionId are required' },
        { status: 400 }
      )
    }

    // Step 1: Find the product by matching barcode to product code
    const product = await db.product.findUnique({
      where: {
        code_sessionId: { code: barcode, sessionId },
      },
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found', barcode },
        { status: 404 }
      )
    }

    // Step 2: Check if product is already complete
    if (product.totalScanned >= product.totalRequested) {
      // Still create a scan event for audit
      await db.scanEvent.create({
        data: {
          barcode,
          productCode: product.code,
          sessionId,
        },
      })
      return NextResponse.json({
        status: 'already_complete',
        message: `Product ${product.code} (${product.description}) already complete: ${product.totalScanned}/${product.totalRequested}`,
        product: {
          code: product.code,
          description: product.description,
          totalRequested: product.totalRequested,
          totalScanned: product.totalScanned,
          status: product.status,
        },
      })
    }

    // Step 3: Find all assignments for this product where scannedQuantity < quantity (FIFO)
    const pendingAssignments = await db.assignment.findMany({
      where: {
        productId: product.id,
        sessionId,
        scannedQuantity: { lt: db.assignment.fields.quantity ? undefined : 999999 },
        // We need: scannedQuantity < quantity
      },
      include: {
        worker: true,
      },
      orderBy: { createdAt: 'asc' }, // FIFO
    })

    // Filter for assignments where scannedQuantity < quantity
    const eligibleAssignments = pendingAssignments.filter(
      (a) => a.scannedQuantity < a.quantity
    )

    if (eligibleAssignments.length === 0) {
      // No assignments for this product - it's an unassigned product
      // Increment product totalScanned anyway
      const newScanned = product.totalScanned + 1
      let newStatus = product.status
      if (newScanned >= product.totalRequested) {
        newStatus = 'complete'
      } else if (newScanned > 0) {
        newStatus = 'partial'
      }

      const updatedProduct = await db.product.update({
        where: { id: product.id },
        data: {
          totalScanned: newScanned,
          status: newStatus,
        },
      })

      await db.scanEvent.create({
        data: {
          barcode,
          productCode: product.code,
          sessionId,
        },
      })

      return NextResponse.json({
        status: 'scanned_unassigned',
        message: `Product ${product.code} scanned (no worker assignments)`,
        product: {
          code: updatedProduct.code,
          description: updatedProduct.description,
          totalRequested: updatedProduct.totalRequested,
          totalScanned: updatedProduct.totalScanned,
          status: updatedProduct.status,
        },
      })
    }

    // Step 4: Assign to the first pending assignment (FIFO)
    const assignment = eligibleAssignments[0]
    const newScannedQty = assignment.scannedQuantity + 1
    const newProductScanned = product.totalScanned + 1

    // Step 5: Update assignment status
    let assignmentStatus = assignment.status
    if (newScannedQty >= assignment.quantity) {
      assignmentStatus = 'complete'
    } else if (newScannedQty > 0) {
      assignmentStatus = 'assigned'
    }

    // Step 6: Update product status
    let productStatus = product.status
    if (newProductScanned >= product.totalRequested) {
      productStatus = 'complete'
    } else if (newProductScanned > 0) {
      productStatus = 'partial'
    }

    // Step 7: Perform updates in a transaction
    const [updatedAssignment, updatedProduct] = await db.$transaction([
      db.assignment.update({
        where: { id: assignment.id },
        data: {
          scannedQuantity: newScannedQty,
          status: assignmentStatus,
        },
      }),
      db.product.update({
        where: { id: product.id },
        data: {
          totalScanned: newProductScanned,
          status: productStatus,
        },
      }),
    ])

    // Step 8: Create ScanEvent
    await db.scanEvent.create({
      data: {
        barcode,
        productCode: product.code,
        workerId: assignment.workerId,
        itinerary: assignment.worker.itinerary,
        assignedTo: assignment.worker.name,
        sessionId,
      },
    })

    // Step 9: Get other products from the same worker in this session
    const otherAssignments = await db.assignment.findMany({
      where: {
        workerId: assignment.workerId,
        sessionId,
        id: { not: assignment.id },
      },
      include: {
        product: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      status: 'assigned',
      message: `Product ${product.code} assigned to ${assignment.worker.name}`,
      assignment: {
        id: updatedAssignment.id,
        workerName: assignment.worker.name,
        workerCode: assignment.worker.code,
        itinerary: assignment.worker.itinerary,
        productCode: product.code,
        productDescription: product.description,
        quantity: assignment.quantity,
        scannedQuantity: newScannedQty,
        status: assignmentStatus,
      },
      product: {
        code: updatedProduct.code,
        description: updatedProduct.description,
        totalRequested: updatedProduct.totalRequested,
        totalScanned: updatedProduct.totalScanned,
        status: updatedProduct.status,
      },
      otherWorkerProducts: otherAssignments.map((a) => ({
        productCode: a.productCode,
        productDescription: a.product.description,
        quantity: a.quantity,
        scannedQuantity: a.scannedQuantity,
        status: a.status,
      })),
    })
  } catch (error) {
    console.error('Error processing scan:', error)
    return NextResponse.json(
      { error: 'Failed to process scan' },
      { status: 500 }
    )
  }
}
