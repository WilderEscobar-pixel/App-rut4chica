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

// POST: Record a barcode scan with auto-assignment algorithm (supports manual quantity)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { barcode, sessionId } = body
    const manualQty = Math.max(body.quantity || 1, 1) // default to 1, minimum 1

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
          quantity: manualQty,
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

    // Calculate how many units can actually be allocated (cap at remaining product need)
    const productRemaining = product.totalRequested - product.totalScanned
    const allocatableQty = Math.min(manualQty, productRemaining)

    if (eligibleAssignments.length === 0) {
      // No assignments for this product - it's an unassigned product
      // Increment product totalScanned by allocatableQty
      const newScanned = product.totalScanned + allocatableQty
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
          quantity: allocatableQty,
        },
      })

      return NextResponse.json({
        status: 'scanned_unassigned',
        message: `Product ${product.code} scanned (no worker assignments)`,
        scannedCount: allocatableQty,
        product: {
          code: updatedProduct.code,
          description: updatedProduct.description,
          totalRequested: updatedProduct.totalRequested,
          totalScanned: updatedProduct.totalScanned,
          status: updatedProduct.status,
        },
      })
    }

    // Step 4: Distribute allocatableQty across eligible assignments using FIFO
    let remainingQty = allocatableQty
    const assignmentUpdates: Array<{
      assignment: (typeof eligibleAssignments)[number]
      allocateQty: number
    }> = []

    for (const assignment of eligibleAssignments) {
      if (remainingQty <= 0) break

      const capacity = assignment.quantity - assignment.scannedQuantity
      const allocateQty = Math.min(capacity, remainingQty)

      assignmentUpdates.push({ assignment, allocateQty })
      remainingQty -= allocateQty
    }

    const totalAllocated = allocatableQty - remainingQty

    // Step 5: Build transaction operations for all assignment updates + product update
    const transactionOps: Promise<unknown>[] = []

    // Update each assignment
    for (const { assignment, allocateQty } of assignmentUpdates) {
      const newScannedQty = assignment.scannedQuantity + allocateQty
      let assignmentStatus = assignment.status
      if (newScannedQty >= assignment.quantity) {
        assignmentStatus = 'complete'
      } else if (newScannedQty > 0) {
        assignmentStatus = 'assigned'
      }

      transactionOps.push(
        db.assignment.update({
          where: { id: assignment.id },
          data: {
            scannedQuantity: newScannedQty,
            status: assignmentStatus,
          },
        })
      )
    }

    // Update product totalScanned and status
    const newProductScanned = product.totalScanned + totalAllocated
    let productStatus = product.status
    if (newProductScanned >= product.totalRequested) {
      productStatus = 'complete'
    } else if (newProductScanned > 0) {
      productStatus = 'partial'
    }

    transactionOps.push(
      db.product.update({
        where: { id: product.id },
        data: {
          totalScanned: newProductScanned,
          status: productStatus,
        },
      })
    )

    // Execute transaction
    const transactionResults = await db.$transaction(transactionOps)
    const updatedProduct = transactionResults[transactionResults.length - 1] as Awaited<
      ReturnType<typeof db.product.update>
    >

    // Step 6: Create ONE ScanEvent for this manual batch
    const primaryAssignment = assignmentUpdates[0]
    const scanEvent = await db.scanEvent.create({
      data: {
        barcode,
        productCode: product.code,
        workerId: primaryAssignment.assignment.workerId,
        itinerary: primaryAssignment.assignment.worker.itinerary,
        assignedTo: primaryAssignment.assignment.worker.name,
        sessionId,
        quantity: totalAllocated,
      },
    })

    // Step 7: Build response with updated assignment details
    const updatedAssignments = assignmentUpdates.map((item, idx) => {
      const assignment = item.assignment
      const newScannedQty = assignment.scannedQuantity + item.allocateQty
      let aStatus = assignment.status
      if (newScannedQty >= assignment.quantity) {
        aStatus = 'complete'
      } else if (newScannedQty > 0) {
        aStatus = 'assigned'
      }

      return {
        id: assignment.id,
        workerName: assignment.worker.name,
        workerCode: assignment.worker.code,
        itinerary: assignment.worker.itinerary,
        productCode: product.code,
        productDescription: product.description,
        quantity: assignment.quantity,
        previousScannedQuantity: assignment.scannedQuantity,
        allocatedQuantity: item.allocateQty,
        scannedQuantity: newScannedQty,
        status: aStatus,
      }
    })

    // Step 8: Get other products from the primary worker in this session
    const primaryWorkerId = primaryAssignment.assignment.workerId
    const otherAssignments = await db.assignment.findMany({
      where: {
        workerId: primaryWorkerId,
        sessionId,
        id: { not: { in: assignmentUpdates.map((a) => a.assignment.id) } },
      },
      include: {
        product: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      status: 'assigned',
      message: `Product ${product.code} - ${totalAllocated} unit(s) assigned across ${assignmentUpdates.length} assignment(s)`,
      scannedCount: totalAllocated,
      quantity: manualQty,
      assignment: updatedAssignments[0], // Primary assignment (backward compat)
      allAssignments: updatedAssignments, // All affected assignments
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
