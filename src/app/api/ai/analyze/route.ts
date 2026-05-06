import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// Module-level ZAI instance — created once and reused
let zaiInstance: ZAI | null = null

async function getZAI(): Promise<ZAI> {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

type AnalysisType =
  | 'summary'
  | 'missing_analysis'
  | 'worker_performance'
  | 'recommendations'

// ---------------------------------------------------------------------------
// Data-fetching helpers
// ---------------------------------------------------------------------------

async function fetchSessionData(sessionId: string) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      products: {
        orderBy: { code: 'asc' },
      },
      assignments: {
        include: {
          worker: true,
          product: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      scanEvents: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  return session
}

// ---------------------------------------------------------------------------
// Prompt builders for each analysis type
// ---------------------------------------------------------------------------

function buildSummaryPrompt(session: NonNullable<Awaited<ReturnType<typeof fetchSessionData>>>): string {
  const totalProducts = session.products.length
  const completed = session.products.filter((p) => p.status === 'complete').length
  const partial = session.products.filter((p) => p.status === 'partial').length
  const pending = session.products.filter((p) => p.status === 'pending').length
  const missing = session.products.filter((p) => p.status === 'missing').length
  const totalRequested = session.products.reduce((sum, p) => sum + p.totalRequested, 0)
  const totalScanned = session.products.reduce((sum, p) => sum + p.totalScanned, 0)
  const progress = totalRequested > 0 ? totalScanned / totalRequested : 0
  const totalAssignments = session.assignments.length
  const completedAssignments = session.assignments.filter((a) => a.status === 'complete').length
  const totalScanEvents = session.scanEvents.length

  // Unique workers
  const workerMap = new Map<string, { name: string; code: string; assignments: number; completed: number }>()
  for (const a of session.assignments) {
    const existing = workerMap.get(a.workerId) || {
      name: a.worker.name,
      code: a.worker.code,
      assignments: 0,
      completed: 0,
    }
    existing.assignments += 1
    if (a.status === 'complete') existing.completed += 1
    workerMap.set(a.workerId, existing)
  }

  const workersInfo = Array.from(workerMap.values())
    .map((w) => `- ${w.name} (${w.code}): ${w.completed}/${w.assignments} asignaciones completadas`)
    .join('\n')

  return `Eres un analista experto en logística de droguería. Genera un resumen general en español de la sesión de escaneo "Chequeo Ruta Chica" de Droguería Nena.

DATOS DE LA SESIÓN:
- Fecha: ${session.date}
- Estado: ${session.status}
- Total de productos: ${totalProducts}
- Productos completados: ${completed}
- Productos parciales: ${partial}
- Productos pendientes: ${pending}
- Productos faltantes: ${missing}
- Unidades solicitadas: ${totalRequested}
- Unidades escaneadas: ${totalScanned}
- Progreso general: ${Math.round(progress * 100)}%
- Total de asignaciones: ${totalAssignments}
- Asignaciones completadas: ${completedAssignments}
- Total de eventos de escaneo: ${totalScanEvents}

TRABAJADORES:
${workersInfo || 'Sin trabajadores asignados'}

PRODUCTOS:
${session.products.map((p) => `[${p.code}] ${p.description} | Solicitado: ${p.totalRequested} | Escaneado: ${p.totalScanned} | Bulto: ${p.bulto} | Origen: ${p.origen} | Estado: ${p.status}`).join('\n')}

Genera un resumen claro y conciso que incluya:
1. Estado general del proceso
2. Progreso global
3. Productos destacados (completados y problemáticos)
4. Rendimiento de los trabajadores
5. Observaciones relevantes`
}

function buildMissingAnalysisPrompt(session: NonNullable<Awaited<ReturnType<typeof fetchSessionData>>>): string {
  const missingProducts = session.products.filter(
    (p) => p.status === 'missing' || p.status === 'pending' || (p.status === 'partial' && p.totalScanned < p.totalRequested)
  )

  const missingDetails = missingProducts.map((p) => {
    const relatedAssignments = session.assignments.filter((a) => a.productId === p.id)
    const assignmentInfo = relatedAssignments
      .map((a) => `  → ${a.worker.name}: ${a.scannedQuantity}/${a.quantity} (${a.status})`)
      .join('\n')

    return `[${p.code}] ${p.description}
  Solicitado: ${p.totalRequested} | Escaneado: ${p.totalScanned} | Déficit: ${p.totalRequested - p.totalScanned} | Bulto: ${p.bulto} | Origen: ${p.origen} | Estado: ${p.status}
${assignmentInfo || '  Sin asignaciones'}`
  }).join('\n\n')

  const totalDeficit = missingProducts.reduce(
    (sum, p) => sum + (p.totalRequested - p.totalScanned),
    0
  )

  return `Eres un analista experto en logística de droguería. Realiza un análisis profundo en español de los productos faltantes o incompletos en la sesión de escaneo "Chequeo Ruta Chica" de Droguería Nena.

SESIÓN: ${session.date} | Estado: ${session.status}
PRODUCTOS CON PROBLEMAS: ${missingProducts.length} de ${session.products.length}
DÉFICIT TOTAL DE UNIDADES: ${totalDeficit}

DETALLE DE PRODUCTOS FALTANTES/INCOMPLETOS:
${missingDetails || 'No hay productos faltantes.'}

PRODUCTOS COMPLETADOS (para contexto):
${session.products
  .filter((p) => p.status === 'complete')
  .map((p) => `[${p.code}] ${p.description} — ${p.totalScanned}/${p.totalRequested}`)
  .join('\n')}

Realiza un análisis que incluya:
1. Clasificación de las causas probables (agotamiento en almacén, error en pedido, extravío, problema de asignación, etc.)
2. Productos con mayor déficit y su impacto
3. Patrones observados (por origen R/G, por bulto, por trabajador)
4. Acciones recomendadas para cada categoría de problema
5. Estimación de la urgencia de cada caso`
}

function buildWorkerPerformancePrompt(session: NonNullable<Awaited<ReturnType<typeof fetchSessionData>>>): string {
  // Group assignments by worker
  const workerMap = new Map<
    string,
    {
      name: string
      code: string
      itinerary: string
      assignments: Array<{
        productCode: string
        productDescription: string
        quantity: number
        scannedQuantity: number
        status: string
      }>
    }
  >()

  for (const a of session.assignments) {
    const existing = workerMap.get(a.workerId) || {
      name: a.worker.name,
      code: a.worker.code,
      itinerary: a.worker.itinerary,
      assignments: [],
    }
    existing.assignments.push({
      productCode: a.productCode,
      productDescription: a.product.description,
      quantity: a.quantity,
      scannedQuantity: a.scannedQuantity,
      status: a.status,
    })
    workerMap.set(a.workerId, existing)
  }

  const workersInfo = Array.from(workerMap.entries())
    .map(([id, w]) => {
      const totalAssigned = w.assignments.reduce((s, a) => s + a.quantity, 0)
      const totalScanned = w.assignments.reduce((s, a) => s + a.scannedQuantity, 0)
      const completedCount = w.assignments.filter((a) => a.status === 'complete').length
      const pendingCount = w.assignments.filter((a) => a.status === 'pending').length
      const partialCount = w.assignments.filter((a) => a.status === 'assigned' || a.status === 'partial').length
      const completionRate = w.assignments.length > 0 ? completedCount / w.assignments.length : 0

      const assignmentDetails = w.assignments
        .map((a) => `    [${a.productCode}] ${a.productDescription}: ${a.scannedQuantity}/${a.quantity} (${a.status})`)
        .join('\n')

      return `TRABAJADOR: ${w.name} (Código: ${w.code}, Itinerario: ${w.itinerary})
  Total asignaciones: ${w.assignments.length}
  Completadas: ${completedCount} | Parciales: ${partialCount} | Pendientes: ${pendingCount}
  Unidades solicitadas: ${totalAssigned} | Unidades escaneadas: ${totalScanned}
  Tasa de completitud: ${Math.round(completionRate * 100)}%
  Detalle:
${assignmentDetails}`
    })
    .join('\n\n')

  // Scan events per worker
  const scanEventsByWorker = new Map<string, number>()
  for (const e of session.scanEvents) {
    if (e.workerId) {
      scanEventsByWorker.set(e.workerId, (scanEventsByWorker.get(e.workerId) || 0) + 1)
    }
  }

  return `Eres un analista experto en rendimiento de personal logístico. Realiza un análisis en español del rendimiento de los trabajadores en la sesión de escaneo "Chequeo Ruta Chica" de Droguería Nena.

SESIÓN: ${session.date} | Estado: ${session.status}
TOTAL DE TRABAJADORES: ${workerMap.size}

DETALLE POR TRABAJADOR:
${workersInfo || 'Sin trabajadores'}

EVENTOS DE ESCANEO POR TRABAJADOR:
${Array.from(scanEventsByWorker.entries())
  .map(([workerId, count]) => {
    const worker = workerMap.get(workerId)
    return worker ? `${worker.name}: ${count} escaneos` : `Desconocido (${workerId}): ${count} escaneos`
  })
  .join('\n') || 'Sin eventos de escaneo'}

Realiza un análisis que incluya:
1. Clasificación de trabajadores por rendimiento (alto, medio, bajo)
2. Trabajadores con mejor y peor desempeño
3. Análisis de cuellos de botella (trabajadores con muchas asignaciones pendientes)
4. Distribución equitativa del trabajo
5. Recomendaciones para mejorar la eficiencia del equipo
6. Patrones por itinerario`
}

function buildRecommendationsPrompt(session: NonNullable<Awaited<ReturnType<typeof fetchSessionData>>>): string {
  const totalProducts = session.products.length
  const completed = session.products.filter((p) => p.status === 'complete').length
  const partial = session.products.filter((p) => p.status === 'partial').length
  const pending = session.products.filter((p) => p.status === 'pending').length
  const missing = session.products.filter((p) => p.status === 'missing').length
  const totalRequested = session.products.reduce((sum, p) => sum + p.totalRequested, 0)
  const totalScanned = session.products.reduce((sum, p) => sum + p.totalScanned, 0)
  const progress = totalRequested > 0 ? totalScanned / totalRequested : 0

  const partialProducts = session.products
    .filter((p) => p.status === 'partial')
    .map((p) => `[${p.code}] ${p.description}: ${p.totalScanned}/${p.totalRequested} (falta ${p.totalRequested - p.totalScanned})`)
    .join('\n')

  const pendingProducts = session.products
    .filter((p) => p.status === 'pending')
    .map((p) => `[${p.code}] ${p.description}: 0/${p.totalRequested}`)
    .join('\n')

  const missingProducts = session.products
    .filter((p) => p.status === 'missing')
    .map((p) => `[${p.code}] ${p.description}`)
    .join('\n')

  // Worker completion rates
  const workerMap = new Map<string, { name: string; completed: number; total: number }>()
  for (const a of session.assignments) {
    const existing = workerMap.get(a.workerId) || { name: a.worker.name, completed: 0, total: 0 }
    existing.total += 1
    if (a.status === 'complete') existing.completed += 1
    workerMap.set(a.workerId, existing)
  }

  const lowPerformers = Array.from(workerMap.entries())
    .filter(([, w]) => w.total > 0 && w.completed / w.total < 0.5)
    .map(([, w]) => `${w.name}: ${w.completed}/${w.total} completadas`)
    .join('\n')

  return `Eres un consultor experto en optimización de procesos logísticos para droguerías. Genera recomendaciones accionables en español para mejorar el proceso de "Chequeo Ruta Chica" de Droguería Nena.

ESTADO ACTUAL DE LA SESIÓN (${session.date}):
- Progreso: ${Math.round(progress * 100)}%
- Total productos: ${totalProducts}
- Completados: ${completed} | Parciales: ${partial} | Pendientes: ${pending} | Faltantes: ${missing}
- Unidades escaneadas: ${totalScanned}/${totalRequested}

PRODUCTOS PARCIALES:
${partialProducts || 'Ninguno'}

PRODUCTOS PENDIENTES:
${pendingProducts || 'Ninguno'}

PRODUCTOS FALTANTES:
${missingProducts || 'Ninguno'}

TRABAJADORES CON BAJO RENDIMIENTO (< 50% completitud):
${lowPerformers || 'Ninguno identificado'}

Genera recomendaciones concretas y accionables que incluyan:
1. Acciones inmediatas para productos faltantes/críticos
2. Estrategias para acelerar el escaneo de productos pendientes y parciales
3. Mejoras en la distribución de trabajo entre trabajadores
4. Sugerencias para prevenir problemas en futuras sesiones
5. Priorización: qué resolver primero y por qué
6. KPIs sugeridos para monitorear la mejora`
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, type } = body as {
      sessionId?: string
      type?: AnalysisType
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { success: false, analysis: 'El campo "sessionId" es requerido.', type: type || 'unknown' },
        { status: 400 }
      )
    }

    const validTypes: AnalysisType[] = [
      'summary',
      'missing_analysis',
      'worker_performance',
      'recommendations',
    ]

    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        {
          success: false,
          analysis: `El campo "type" debe ser uno de: ${validTypes.join(', ')}.`,
          type: type || 'unknown',
        },
        { status: 400 }
      )
    }

    // Fetch session data from the database
    const session = await fetchSessionData(sessionId)

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          analysis: 'No se encontró la sesión especificada.',
          type,
        },
        { status: 404 }
      )
    }

    // Build the appropriate prompt based on the analysis type
    let prompt: string
    switch (type) {
      case 'summary':
        prompt = buildSummaryPrompt(session)
        break
      case 'missing_analysis':
        prompt = buildMissingAnalysisPrompt(session)
        break
      case 'worker_performance':
        prompt = buildWorkerPerformancePrompt(session)
        break
      case 'recommendations':
        prompt = buildRecommendationsPrompt(session)
        break
    }

    const zai = await getZAI()

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: prompt },
        { role: 'user', content: 'Realiza el análisis solicitado con base en los datos proporcionados.' },
      ],
      thinking: { type: 'disabled' },
    })

    const analysisContent = completion.choices?.[0]?.message?.content

    if (!analysisContent) {
      return NextResponse.json(
        {
          success: false,
          analysis:
            'No se pudo generar el análisis. Por favor, intenta de nuevo.',
          type,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      analysis: analysisContent,
      type,
    })
  } catch (error) {
    console.error('Error in AI analyze endpoint:', error)

    const errorMessage =
      error instanceof Error ? error.message : 'Error desconocido'

    // Provide a helpful fallback message when the AI service is unavailable
    if (
      errorMessage.includes('API request failed') ||
      errorMessage.includes('fetch') ||
      errorMessage.includes('network') ||
      errorMessage.includes('ECONNREFUSED')
    ) {
      return NextResponse.json({
        success: false,
        analysis:
          'El servicio de IA no está disponible en este momento. Por favor, verifica tu conexión e intenta de nuevo más tarde. Si el problema persiste, contacta al administrador del sistema.',
        type: (body as { type?: string })?.type || 'unknown',
      })
    }

    return NextResponse.json(
      {
        success: false,
        analysis: `Error al procesar el análisis: ${errorMessage}. Por favor, intenta de nuevo.`,
        type: (body as { type?: string })?.type || 'unknown',
      },
      { status: 500 }
    )
  }
}
