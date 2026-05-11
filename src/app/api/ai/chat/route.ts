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

interface ChatContext {
  products?: Array<{
    code: string
    description: string
    totalRequested: number
    totalScanned: number
    status: string
  }>
  summary?: {
    totalProducts?: number
    completed?: number
    partial?: number
    pending?: number
    missing?: number
    totalScanned?: number
    totalRequested?: number
    progress?: number
  }
  scanEvents?: Array<{
    barcode: string
    productCode: string
    assignedTo?: string
    createdAt: string
  }>
}

interface ChatHistoryItem {
  role: string
  content: string
}

function buildSystemPrompt(context?: ChatContext): string {
  let prompt = `Eres un asistente experto en el proceso de "Chequeo Ruta Chica" para Droguería Nena. Tu rol es ayudar al personal de la droguería durante el escaneo de productos para el control de inventario.

Conoces en detalle el flujo de trabajo:
1. Se carga un archivo Excel con los productos y cantidades solicitadas (Fuente 1 - Totales)
2. Se carga un PDF con las notas de entrega que contienen las asignaciones de productos a trabajadores/rutas (Fuente 2 - Asignación)
3. Los trabajadores escanean los códigos de barras de los productos conforme los van despachando
4. El sistema automáticamente asigna cada escaneo al trabajador correspondiente usando FIFO
5. Se hace seguimiento del progreso: pendiente → parcial → completo

Puedes ayudar con:
- Responder preguntas sobre el proceso de escaneo
- Ayudar a identificar productos por código o descripción
- Informar qué productos lleva un trabajador específico (buscar por código o nombre)
- Sugerir acciones cuando hay productos faltantes
- Proporcionar insights sobre el progreso del escaneo
- Ayudar a solucionar problemas técnicos del escaneo
- Explicar el significado de los estados (pending, partial, complete, missing)
- Orientar sobre cómo manejar productos con escaneo excedido o insuficiente

Responde siempre en español, de forma clara y concisa. Si no tienes suficiente información, pide aclaraciones.`

  if (context) {
    prompt += '\n\n--- CONTEXTO DE LA SESIÓN ACTUAL ---\n'

    if (context.summary) {
      const s = context.summary
      prompt += `\nResumen general:
- Total de productos: ${s.totalProducts ?? 'N/A'}
- Completados: ${s.completed ?? 'N/A'}
- Parciales: ${s.partial ?? 'N/A'}
- Pendientes: ${s.pending ?? 'N/A'}
- Faltantes: ${s.missing ?? 'N/A'}
- Unidades escaneadas: ${s.totalScanned ?? 'N/A'} / ${s.totalRequested ?? 'N/A'}
- Progreso: ${s.progress != null ? `${Math.round(s.progress * 100)}%` : 'N/A'}\n`
    }

    if (context.products && context.products.length > 0) {
      prompt += '\nProductos en la sesión:\n'
      for (const p of context.products) {
        prompt += `- [${p.code}] ${p.description} | Solicitado: ${p.totalRequested} | Escaneado: ${p.totalScanned} | Estado: ${p.status}\n`
      }
    }

    if (context.scanEvents && context.scanEvents.length > 0) {
      prompt += '\nÚltimos eventos de escaneo:\n'
      for (const e of context.scanEvents) {
        prompt += `- Código: ${e.barcode} → Producto: ${e.productCode}${e.assignedTo ? ` → Asignado a: ${e.assignedTo}` : ''} (${e.createdAt})\n`
      }
    }

    prompt += '\n--- FIN DEL CONTEXTO ---\n'
  }

  return prompt
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, sessionId, context, history } = body as {
      message?: string
      sessionId?: string
      context?: ChatContext
      history?: ChatHistoryItem[]
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { success: false, response: 'El campo "message" es requerido.' },
        { status: 400 }
      )
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { success: false, response: 'El campo "sessionId" es requerido.' },
        { status: 400 }
      )
    }

    // Build worker context if the user is asking about workers
    let workerContext = ''
    const lowerMessage = message.toLowerCase()

    // Check if the user is asking about a specific worker
    const workerCodeMatch = message.match(/\b([A-Z0-9]{2,6})\b/i)
    if (workerCodeMatch && (lowerMessage.includes('trabajador') || lowerMessage.includes('lleva') || lowerMessage.includes('pedido') || lowerMessage.includes('productos'))) {
      const potentialCode = workerCodeMatch[1].toUpperCase()
      try {
        const worker = await db.worker.findUnique({
          where: { code: potentialCode },
          include: {
            assignments: {
              where: { sessionId },
              include: {
                product: {
                  select: { code: true, description: true, totalRequested: true, totalScanned: true, status: true },
                },
              },
            },
          },
        })
        if (worker) {
          workerContext = `\n\n--- INFORMACIÓN DEL TRABAJADOR ---\n`
          workerContext += `Código: ${worker.code}\nNombre: ${worker.name}\nItinerario: ${worker.itinerary}\nRIF: ${worker.rif || 'N/A'}\n`
          workerContext += `Total asignaciones: ${worker.assignments.length}\n`
          if (worker.assignments.length > 0) {
            workerContext += `\nProductos asignados:\n`
            for (const a of worker.assignments) {
              workerContext += `- [${a.productCode}] ${a.product.description} | Cantidad: ${a.quantity} | Escaneado: ${a.scannedQuantity} | Estado: ${a.status}\n`
            }
          }
          workerContext += `\n--- FIN INFORMACIÓN DEL TRABAJADOR ---\n`
        }
      } catch {
        // Worker lookup failed, continue without worker context
      }
    }

    // If the user is asking about workers in general, load all workers with session context
    if ((lowerMessage.includes('trabajadores') || lowerMessage.includes('vendedores')) && !workerContext) {
      try {
        const workers = await db.worker.findMany({
          include: {
            assignments: {
              where: { sessionId },
              select: { productCode: true, quantity: true, scannedQuantity: true, status: true },
            },
          },
          take: 50,
          orderBy: { code: 'asc' },
        })
        if (workers.length > 0) {
          workerContext = `\n\n--- LISTA DE TRABAJADORES ---\n`
          for (const w of workers) {
            const totalAssigned = w.assignments.reduce((s, a) => s + a.quantity, 0)
            const totalScanned = w.assignments.reduce((s, a) => s + a.scannedQuantity, 0)
            const completed = w.assignments.filter(a => a.status === 'complete').length
            workerContext += `- ${w.name} (Cod: ${w.code}, It: ${w.itinerary}) | ${completed}/${w.assignments.length} completos | ${totalScanned}/${totalAssigned} unidades\n`
          }
          workerContext += `\n--- FIN LISTA DE TRABAJADORES ---\n`
        }
      } catch {
        // Worker list failed, continue without
      }
    }

    const zai = await getZAI()

    // Build the system prompt with optional context
    const systemPrompt = buildSystemPrompt(context) + workerContext

    // Build conversation messages
    const messages: Array<{ role: 'assistant' | 'user'; content: string }> = [
      { role: 'assistant', content: systemPrompt },
    ]

    // Include conversation history if provided
    if (history && Array.isArray(history) && history.length > 0) {
      for (const item of history) {
        if (
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.content === 'string'
        ) {
          messages.push({
            role: item.role as 'user' | 'assistant',
            content: item.content,
          })
        }
      }
    }

    // Add the current user message
    messages.push({ role: 'user', content: message })

    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    })

    const responseContent = completion.choices?.[0]?.message?.content

    if (!responseContent) {
      return NextResponse.json(
        {
          success: false,
          response:
            'No se pudo generar una respuesta. Por favor, intenta de nuevo.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      response: responseContent,
    })
  } catch (error) {
    console.error('Error in AI chat endpoint:', error)

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
        response:
          'El servicio de IA no está disponible en este momento. Por favor, verifica tu conexión e intenta de nuevo más tarde. Si el problema persiste, contacta al administrador del sistema.',
      })
    }

    return NextResponse.json(
      {
        success: false,
        response: `Error al procesar la solicitud: ${errorMessage}. Por favor, intenta de nuevo.`,
      },
      { status: 500 }
    )
  }
}
