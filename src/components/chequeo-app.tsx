'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, Upload, ScanLine, CheckCircle2, AlertTriangle,
  XCircle, Search, Filter, BarChart3, FileDown,
  ChevronDown, ChevronUp, RefreshCw, Lock, Sun, Moon,
  PackageCheck, PackageX, ClipboardList,
  FileSpreadsheet, FileText, Loader2, Scan, CircleDot,
  RotateCcw, Zap, Eye, Sparkles, Volume2, VolumeX,
  MessageSquare, Send, Bot, User, Brain,
  PlusCircle, Minus, Plus, Hash, Save, PlayCircle,
  LogOut, Circle
} from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'

import { useAppStore, type ProductData, type AssignmentData, type ScanResult, type CheckAssignmentResult } from '@/lib/store'
import { useScanner } from '@/hooks/use-scanner'
import { playSuccessSound, playAlertSound, playCompleteSound } from '@/lib/audio-feedback'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

// ─── Animation Variants ──────────────────────────────────────────────

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] }
}

const statusTransition = {
  initial: { scale: 1 },
  animate: { scale: [1, 1.05, 1] },
  transition: { duration: 0.3 }
}

const slideInRight = {
  initial: { opacity: 0, x: 80 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 80 },
  transition: { type: 'spring' as const, damping: 25, stiffness: 300 }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'complete': return 'bg-emerald-500'
    case 'partial': return 'bg-amber-400'
    case 'pending': return 'bg-slate-300 dark:bg-slate-600'
    case 'missing': return 'bg-red-500'
    default: return 'bg-slate-300'
  }
}

function getStatusBorderColor(status: string): string {
  switch (status) {
    case 'complete': return 'border-l-emerald-500'
    case 'partial': return 'border-l-amber-400'
    case 'pending': return 'border-l-slate-300 dark:border-l-slate-600'
    case 'missing': return 'border-l-red-500'
    default: return 'border-l-slate-300'
  }
}

function getStatusBgColor(status: string): string {
  switch (status) {
    case 'complete': return 'bg-emerald-50/80 dark:bg-emerald-950/20'
    case 'partial': return 'bg-amber-50/80 dark:bg-amber-950/20'
    case 'pending': return 'bg-white/50 dark:bg-slate-900/50'
    case 'missing': return 'bg-red-50/80 dark:bg-red-950/20'
    default: return 'bg-white/50 dark:bg-slate-900/50'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'complete': return 'Completo'
    case 'partial': return 'Parcial'
    case 'pending': return 'Pendiente'
    case 'missing': return 'Faltante'
    default: return status
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'complete': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    case 'partial': return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'pending': return <CircleDot className="h-4 w-4 text-slate-400" />
    case 'missing': return <XCircle className="h-4 w-4 text-red-500" />
    default: return <CircleDot className="h-4 w-4 text-slate-400" />
  }
}

function formatDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-')
    return `${d}/${m}/${y}`
  } catch {
    return dateStr
  }
}

// ─── Sub-Components ──────────────────────────────────────────────────

// Header Component
function AppHeader({ userName, onLogout, isLoggingOut }: { userName?: string; onLogout?: () => void; isLoggingOut?: boolean }) {
  const session = useAppStore((s) => s.session)
  const isSocketConnected = useAppStore((s) => s.isSocketConnected)
  const isScannerListening = useAppStore((s) => s.isScannerListening)
  const fetchProducts = useAppStore((s) => s.fetchProducts)
  const products = useAppStore((s) => s.products)
  const productSummary = useAppStore((s) => s.productSummary)
  const { theme, setTheme } = useTheme()
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [showResumeDialog, setShowResumeDialog] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const isFinalizing = useAppStore((s) => s.isFinalizing)
  const isResetting = useAppStore((s) => s.isResetting)
  const isSaving = useAppStore((s) => s.isSaving)
  const isResuming = useAppStore((s) => s.isResuming)
  const finalizeSession = useAppStore((s) => s.finalizeSession)
  const resetSession = useAppStore((s) => s.resetSession)
  const saveSession = useAppStore((s) => s.saveSession)
  const resumeSession = useAppStore((s) => s.resumeSession)
  const savedSessions = useAppStore((s) => s.savedSessions)

  const totalProgress = useMemo(() => {
    if (!productSummary || productSummary.total === 0) return 0
    return Math.round((productSummary.complete / productSummary.total) * 100)
  }, [productSummary])

  const handleRefresh = async () => {
    await fetchProducts()
    toast.success('Datos actualizados')
  }

  const handleFinalize = async () => {
    const success = await finalizeSession()
    if (success) {
      toast.success('Sesión finalizada exitosamente')
      setShowFinalizeDialog(false)
    } else {
      toast.error('Error al finalizar la sesión')
    }
  }

  const handleSave = async () => {
    const success = await saveSession()
    if (success) {
      toast.success('Sesión guardada. Puede reanudarla cuando desee.')
      setShowSaveDialog(false)
    } else {
      toast.error('Error al guardar la sesión')
    }
  }

  const handleResume = async (sessionId: string) => {
    const success = await resumeSession(sessionId)
    if (success) {
      toast.success('¡Jornada reanudada! Continúe escaneando los productos pendientes.')
      setShowResumeDialog(false)
    } else {
      toast.error('Error al reanudar la sesión')
    }
  }

  const handleReset = async () => {
    const result = await resetSession(true)
    if (result) {
      toast.success('Nueva jornada iniciada. Puede cargar nuevos archivos.')
      setShowResetDialog(false)
    } else {
      toast.error('Error al reiniciar la sesión')
    }
  }

  return (
    <header className="sticky top-0 z-50 glass-header">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-[#007BFF] to-[#339DFF] shadow-lg shadow-[#007BFF]/25">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                <span className="text-gradient-electric">Chequeo Ruta Chica</span>
              </h1>
              <p className="text-xs text-muted-foreground">Droguería Nena</p>
            </div>
          </div>

          {/* Center: Session info & Progress */}
          <div className="hidden md:flex items-center gap-4 flex-1 justify-center">
            {session && (
              <div className="flex items-center gap-3">
                <Badge 
                  variant={session.status === 'active' ? 'default' : session.status === 'saved' ? 'secondary' : 'destructive'} 
                  className="text-xs font-medium"
                >
                  {session.status === 'active' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Activa
                    </span>
                  ) : session.status === 'saved' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Guardada
                    </span>
                  ) : 'Cerrada'}
                </Badge>
                <span className="text-sm text-muted-foreground font-medium">
                  {formatDate(session.date)}
                </span>
                {productSummary && productSummary.total > 0 && (
                  <>
                    <Separator orientation="vertical" className="h-5" />
                    <div className="flex items-center gap-2 min-w-[220px]">
                      <div className="relative flex-1">
                        <Progress value={totalProgress} className="h-2.5" />
                        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#007BFF]/20 to-transparent pointer-events-none" />
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                        {productSummary.complete}/{productSummary.total} ({totalProgress}%)
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* User badge - compact with tooltip */}
            {userName && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center cursor-default">
                        <span className="text-[10px] font-bold text-white">{userName.charAt(0)}</span>
                      </div>
                      {onLogout && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={onLogout}
                          disabled={isLoggingOut}
                          className="h-6 w-6 rounded-md hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500"
                        >
                          {isLoggingOut ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <LogOut className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{userName}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <Separator orientation="vertical" className="h-5" />

            {/* Scanner Status - Click for help */}
            <Dialog>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                      <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm hover:bg-white/80 dark:hover:bg-slate-800/80 transition-colors">
                        <div className={`h-2 w-2 rounded-full transition-colors ${isScannerListening ? 'bg-emerald-500 animate-pulse' : isSocketConnected ? 'bg-amber-400' : 'bg-red-500'}`} />
                        <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </DialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isScannerListening ? 'Escáner activo - Clic para ayuda' : isSocketConnected ? 'Escáner conectado - Clic para ayuda' : 'Escáner desconectado - Clic para ayuda'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DialogContent className="glass-card rounded-2xl max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
                      <ScanLine className="h-4 w-4 text-white" />
                    </div>
                    Conexión de Escáner
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                  {/* Status */}
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-slate-800/40">
                    <div className={`h-3 w-3 rounded-full ${isScannerListening ? 'bg-emerald-500 animate-pulse' : isSocketConnected ? 'bg-amber-400' : 'bg-red-500'}`} />
                    <span className="font-medium">
                      {isScannerListening ? 'Escáner activo y escuchando' : isSocketConnected ? 'Escáner conectado en espera' : 'Escáner desconectado'}
                    </span>
                  </div>

                  {/* USB/Bluetooth Scanner Info */}
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-[#007BFF]" />
                      Escáner USB / Bluetooth
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Los escáneres de código de barras USB y Bluetooth funcionan como teclados. Simplemente:
                    </p>
                    <ol className="text-xs text-muted-foreground space-y-1 ml-4 list-decimal">
                      <li>Conecte el escáner al puerto USB o emparéjelo por Bluetooth</li>
                      <li>El escáner leerá el código de barras y lo enviará como texto rápido</li>
                      <li>La app detecta automáticamente las lecturas rápidas y las procesa</li>
                      <li>No necesita hacer clic en ningún campo de texto</li>
                    </ol>
                  </div>

                  <Separator />

                  {/* Manual Entry Info */}
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-1.5">
                      <PlusCircle className="h-4 w-4 text-[#007BFF]" />
                      Entrada Manual de Cantidad
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      ¿Sabes cuántas unidades hay pero no quieres escanear una por una? Usa el botón <strong>+</strong> junto a cada producto para agregar la cantidad directamente.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ejemplo: Si escaneas 1 "Flips Dulce de Leche" pero sabes que hay 12, haz clic en el botón <strong>+</strong> del producto y ajusta la cantidad a 12.
                    </p>
                  </div>

                  <Separator />

                  {/* WiFi Scanner Info */}
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-[#007BFF]" />
                      Escáner WiFi / Inalámbrico
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Los escáneres WiFi funcionan igual que los USB/Bluetooth — envían caracteres de teclado. Para conectar:
                    </p>
                    <ol className="text-xs text-muted-foreground space-y-1 ml-4 list-decimal">
                      <li>Configure el escáner en modo <strong>SSP (Serial Socket Profile)</strong> o <strong>Virtual COM</strong></li>
                      <li>Conecte el escáner a la misma red WiFi que su computadora</li>
                      <li>Instale el software del fabricante que convierte las lecturas en entrada de teclado</li>
                      <li>El escáner enviará los códigos como si fueran tecleados — la app los detecta automáticamente</li>
                    </ol>
                    <p className="text-xs text-muted-foreground mt-1">
                      <strong>Alternativa:</strong> Si el escáner WiFi envía datos a una IP/puerto, puede usar un puente de software (como <em>Serial to Keyboard</em>) para redirigir las lecturas como entrada de teclado.
                    </p>
                  </div>

                  <Separator />

                  {/* Tips */}
                  <div className="space-y-2">
                    <h4 className="font-semibold flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-[#007BFF]" />
                      Consejos
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                      <li>El escáner debe configurarse para enviar <strong>Enter</strong> al final de cada lectura</li>
                      <li>El indicador verde = escáner activo y escuchando</li>
                      <li>Si no funciona, verifique que el escáner envíe los caracteres rápidamente (menos de 50ms entre teclas)</li>
                    </ul>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Audio Toggle */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setAudioEnabled(!audioEnabled)}
                    className="h-8 w-8 rounded-xl"
                  >
                    {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {audioEnabled ? 'Sonidos activados' : 'Sonidos desactivados'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Separator orientation="vertical" className="h-6" />

            {/* Refresh */}
            <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8 rounded-xl hover:bg-[#007BFF]/10">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Theme Toggle */}
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="h-8 w-8 rounded-xl hover:bg-[#007BFF]/10">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Nueva Jornada */}
            {session && (
              <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowResetDialog(true)}
                        className="gap-1.5 rounded-xl border-[#007BFF]/30 hover:bg-[#007BFF]/10 hover:border-[#007BFF]/50 text-[#007BFF]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Nueva Jornada</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Reiniciar sesión para cargar nuevos archivos</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <AlertDialogContent className="glass-card rounded-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <RotateCcw className="h-5 w-5 text-[#007BFF]" />
                      ¿Iniciar Nueva Jornada?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acción eliminará todos los datos de la sesión actual (productos, asignaciones y escaneos). 
                      Podrá cargar nuevos archivos Excel y PDF para la nueva jornada. Los datos de trabajadores se conservarán.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleReset}
                      disabled={isResetting}
                      className="bg-[#007BFF] hover:bg-[#0056b3] rounded-xl"
                    >
                      {isResetting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Reiniciando...
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Iniciar Nueva Jornada
                        </>
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Finalize / Save buttons */}
            {session?.status === 'active' && products.length > 0 && (
              <>
                {/* Guardar (Save) */}
                <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-amber-500/50 hover:bg-amber-500/10 text-amber-600">
                            <Save className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Guardar</span>
                          </Button>
                        </AlertDialogTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Guardar progreso sin marcar faltantes</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <AlertDialogContent className="glass-card rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2">
                        <Save className="h-5 w-5 text-amber-500" />
                        ¿Guardar sesión?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción guardará el progreso actual sin marcar productos como faltantes.
                        Podrá reanudar la sesión más tarde para continuar escaneando los productos pendientes.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-amber-500 hover:bg-amber-600 rounded-xl"
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Guardando...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Guardar Sesión
                          </>
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {/* Finalizar */}
                <AlertDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1.5 rounded-xl">
                      <Lock className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Finalizar</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="glass-card rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Finalizar sesión de escaneo?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción cerrará la sesión y marcará todos los productos pendientes o parciales como &quot;Faltante&quot;. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleFinalize}
                        disabled={isFinalizing}
                        className="bg-red-600 hover:bg-red-700 rounded-xl"
                      >
                        {isFinalizing ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Finalizando...
                          </>
                        ) : (
                          'Finalizar Sesión'
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}

            {/* Reanudar Jornada - appears when there are saved sessions */}
            {savedSessions.length > 0 && session?.status !== 'active' && (
              <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-xl border-emerald-500/50 hover:bg-emerald-500/10 text-emerald-600">
                          <PlayCircle className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Reanudar Jornada</span>
                        </Button>
                      </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Reanudar una jornada guardada anteriormente</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <AlertDialogContent className="glass-card rounded-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <PlayCircle className="h-5 w-5 text-emerald-500" />
                      Reanudar Jornada Guardada
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Seleccione la jornada guardada que desea reanudar para continuar escaneando:
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar my-2">
                    {savedSessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleResume(s.id)}
                        disabled={isResuming}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-border/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-medium">{formatDate(s.date)}</p>
                          <p className="text-xs text-muted-foreground">
                            {s._count?.products || 0} productos • {s._count?.scanEvents || 0} escaneos
                          </p>
                        </div>
                        <PlayCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

// Upload Panel Component
function UploadPanel() {
  const uploadFiles = useAppStore((s) => s.uploadFiles)
  const isUploading = useAppStore((s) => s.isUploading)
  const session = useAppStore((s) => s.session)
  const ocrMethod = useAppStore((s) => s.ocrMethod)
  const ocrConfidence = useAppStore((s) => s.ocrConfidence)
  const [excelFiles, setExcelFiles] = useState<File[]>([])
  const [pdfFiles, setPdfFiles] = useState<File[]>([])
  const [uploadResult, setUploadResult] = useState<{
    productsCreated: number
    workersCreated: number
    workersUpdated: number
    assignmentsCreated: number
    errors: string[]
    ocrMethod?: string
    ocrConfidence?: number
  } | null>(null)
  const [isDraggingExcel, setIsDraggingExcel] = useState(false)
  const [isDraggingPdf, setIsDraggingPdf] = useState(false)
  const excelInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (excelFiles.length === 0) {
      toast.error('Debe seleccionar al menos un archivo Excel')
      return
    }
    const result = await uploadFiles(excelFiles, pdfFiles)
    if (result?.results) {
      setUploadResult(result.results)
      if (result.results.errors.length === 0) {
        toast.success('Archivos procesados exitosamente')
      } else if (result.results.productsCreated > 0) {
        toast.warning('Archivos procesados con algunos errores')
      } else {
        toast.error('Error al procesar los archivos')
      }
    } else {
      toast.error('Error al cargar archivos')
    }
  }

  const handleDragOver = (e: React.DragEvent, type: 'excel' | 'pdf') => {
    e.preventDefault()
    if (type === 'excel') setIsDraggingExcel(true)
    else setIsDraggingPdf(true)
  }

  const handleDragLeave = (type: 'excel' | 'pdf') => {
    if (type === 'excel') setIsDraggingExcel(false)
    else setIsDraggingPdf(false)
  }

  const handleDrop = (e: React.DragEvent, type: 'excel' | 'pdf') => {
    e.preventDefault()
    if (type === 'excel') setIsDraggingExcel(false)
    else setIsDraggingPdf(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    if (type === 'excel') {
      const validFiles = droppedFiles.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
      if (validFiles.length === 0) {
        toast.error('Los archivos Excel deben ser .xlsx o .xls')
        return
      }
      setExcelFiles(prev => [...prev, ...validFiles].slice(0, 2))
    } else {
      const validFiles = droppedFiles.filter(f => f.name.endsWith('.pdf'))
      if (validFiles.length === 0) {
        toast.error('Los archivos PDF deben ser .pdf')
        return
      }
      setPdfFiles(prev => [...prev, ...validFiles])
    }
  }

  if (session?.status === 'closed' || session?.status === 'saved') {
    return null
  }

  return (
    <motion.div {...fadeInUp}>
      <Card className="glass-card rounded-2xl overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
              <Upload className="h-3 w-3 text-white" />
            </div>
            Cargar Datos del Día
          </CardTitle>
          <CardDescription className="text-xs">
            Suba el archivo Excel con los productos del día. Opcionalmente agregue PDFs con las notas de entrega para registrar trabajadores y sus asignaciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Excel Input */}
          <div
            className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${
              isDraggingExcel 
                ? 'border-[#007BFF] bg-[#007BFF]/5 dark:bg-[#007BFF]/10' 
                : excelFiles.length > 0
                  ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/10'
                  : 'border-muted-foreground/20 hover:border-[#007BFF]/50 hover:bg-[#007BFF]/5'
            }`}
            onDragOver={(e) => handleDragOver(e, 'excel')}
            onDragLeave={() => handleDragLeave('excel')}
            onDrop={(e) => handleDrop(e, 'excel')}
            onClick={() => excelInputRef.current?.click()}
          >
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : []
                const validFiles = files.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))
                setExcelFiles(prev => [...prev, ...validFiles].slice(0, 2))
                // Reset input so same file can be re-selected
                e.target.value = ''
              }}
            />
            <FileSpreadsheet className="h-6 w-6 mx-auto mb-1.5 text-emerald-500" />
            {excelFiles.length > 0 ? (
              <div className="space-y-1">
                {excelFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center justify-center gap-1.5">
                    <span className="text-xs font-medium truncate max-w-[180px]">{f.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setExcelFiles(prev => prev.filter((_, idx) => idx !== i)) }}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {excelFiles.length < 2 && (
                  <p className="text-[10px] text-muted-foreground">+ Agregar otro Excel</p>
                )}
              </div>
            ) : (
              <p className="text-xs font-medium">Archivos Excel (.xlsx) — máx. 2</p>
            )}
            {excelFiles.length > 0 && (
              <Badge variant="secondary" className="mt-1.5 text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                ✓ {excelFiles.length} archivo{excelFiles.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* PDF Input */}
          <div
            className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${
              isDraggingPdf 
                ? 'border-[#007BFF] bg-[#007BFF]/5 dark:bg-[#007BFF]/10' 
                : pdfFiles.length > 0
                  ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/10'
                  : 'border-muted-foreground/20 hover:border-[#007BFF]/50 hover:bg-[#007BFF]/5'
            }`}
            onDragOver={(e) => handleDragOver(e, 'pdf')}
            onDragLeave={() => handleDragLeave('pdf')}
            onDrop={(e) => handleDrop(e, 'pdf')}
            onClick={() => pdfInputRef.current?.click()}
          >
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : []
                const validFiles = files.filter(f => f.name.endsWith('.pdf'))
                setPdfFiles(prev => [...prev, ...validFiles])
                // Reset input so same file can be re-selected
                e.target.value = ''
              }}
            />
            <div className="flex items-center justify-center gap-1.5 mb-1.5">
              <FileText className="h-6 w-6 text-red-500" />
              <Eye className="h-3.5 w-3.5 text-[#007BFF]" />
            </div>
            {pdfFiles.length > 0 ? (
              <div className="space-y-1">
                {pdfFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center justify-center gap-1.5">
                    <span className="text-xs font-medium truncate max-w-[180px]">{f.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPdfFiles(prev => prev.filter((_, idx) => idx !== i)) }}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">+ Agregar otro PDF</p>
              </div>
            ) : (
              <p className="text-xs font-medium">Archivos PDF (OCR automático) — sin límite</p>
            )}
            {pdfFiles.length > 0 && (
              <Badge variant="secondary" className="mt-1.5 text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                ✓ {pdfFiles.length} archivo{pdfFiles.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* Upload Button */}
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
            <Button
              onClick={handleUpload}
              disabled={isUploading || excelFiles.length === 0}
              className="w-full bg-gradient-to-r from-[#007BFF] to-[#339DFF] hover:from-[#0056b3] hover:to-[#007BFF] text-white rounded-xl shadow-lg shadow-[#007BFF]/20 h-10"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Procesando con OCR...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Cargar y Procesar
                </>
              )}
            </Button>
          </motion.div>

          {/* OCR Status during upload */}
          <AnimatePresence>
            {isUploading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center gap-2 text-xs text-[#007BFF]">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  <span>Procesando PDF con motor OCR...</span>
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-full rounded-full" />
                  <Skeleton className="h-3 w-3/4 rounded-full" />
                  <Skeleton className="h-3 w-1/2 rounded-full" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Upload Results */}
          <AnimatePresence>
            {uploadResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1.5"
              >
                <Separator />
                <div className="text-xs space-y-1.5 pt-1">
                  <p className="text-emerald-600 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3" />
                    {uploadResult.productsCreated} productos creados
                  </p>
                  <p className="text-[#007BFF] font-medium flex items-center gap-1.5">
                    <PackageCheck className="h-3 w-3" />
                    {uploadResult.workersCreated} trabajadores creados, {uploadResult.workersUpdated} actualizados
                  </p>
                  <p className="text-amber-600 font-medium flex items-center gap-1.5">
                    <ClipboardList className="h-3 w-3" />
                    {uploadResult.assignmentsCreated} asignaciones creadas
                  </p>
                  {uploadResult.ocrMethod && (
                    <p className="text-purple-600 font-medium flex items-center gap-1.5">
                      <Eye className="h-3 w-3" />
                      PDF procesado vía {uploadResult.ocrMethod === 'ocr' ? 'OCR (Tesseract)' : 'Texto directo'}
                      {uploadResult.ocrConfidence != null && ` — ${uploadResult.ocrConfidence}% confianza`}
                    </p>
                  )}
                  {uploadResult.errors.length > 0 && (
                    <div className="text-red-500 mt-1">
                      <p className="font-medium">{uploadResult.errors.length} errores:</p>
                      <ScrollArea className="max-h-16">
                        {uploadResult.errors.slice(0, 5).map((err, i) => (
                          <p key={i} className="text-[10px]">• {err}</p>
                        ))}
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Quick Stats Component
function QuickStats() {
  const productSummary = useAppStore((s) => s.productSummary)
  const scanEvents = useAppStore((s) => s.scanEvents)

  if (!productSummary || productSummary.total === 0) {
    return (
      <motion.div {...fadeInUp}>
        <Card className="glass-card rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
                <BarChart3 className="h-3 w-3 text-white" />
              </div>
              Resumen Rápido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground text-center py-4">
              Cargue los archivos para ver estadísticas
            </p>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  const stats = [
    { label: 'Pendientes', value: productSummary.pending, color: 'text-slate-500', bg: 'bg-slate-100/80 dark:bg-slate-800/50', icon: CircleDot, glow: '' },
    { label: 'Parciales', value: productSummary.partial, color: 'text-amber-600', bg: 'bg-amber-100/80 dark:bg-amber-950/20', icon: AlertTriangle, glow: productSummary.partial > 0 ? 'glow-warning' : '' },
    { label: 'Completos', value: productSummary.complete, color: 'text-emerald-600', bg: 'bg-emerald-100/80 dark:bg-emerald-950/20', icon: CheckCircle2, glow: '' },
    { label: 'Faltantes', value: productSummary.missing, color: 'text-red-600', bg: 'bg-red-100/80 dark:bg-red-950/20', icon: XCircle, glow: productSummary.missing > 0 ? 'glow-danger' : '' },
  ]

  return (
    <motion.div {...fadeInUp}>
      <Card className="glass-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
              <BarChart3 className="h-3 w-3 text-white" />
            </div>
            Resumen Rápido
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {stats.map((stat, idx) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`flex items-center gap-2 p-2.5 rounded-xl ${stat.bg} ${stat.glow} transition-shadow`}
              >
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
                <div>
                  <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                </div>
              </motion.div>
            ))}
          </div>
          <Separator />
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Unidades escaneadas</span>
            <span className="font-semibold">
              {productSummary.totalScanned}/{productSummary.totalRequested}
            </span>
          </div>
          <Progress
            value={productSummary.totalRequested > 0 ? (productSummary.totalScanned / productSummary.totalRequested) * 100 : 0}
            className="h-2.5"
          />
          {scanEvents.length > 0 && (
            <div className="flex justify-between text-xs pt-1">
              <span className="text-muted-foreground">Total escaneos</span>
              <span className="font-semibold">{scanEvents.length}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── AI Components ──────────────────────────────────────────────────

// Simple markdown-like formatter for AI responses
function formatAIMessage(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      nodes.push(<br key={`br-${i}`} />)
      return
    }
    // Handle bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    const formatted = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`b-${i}-${j}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
      }
      return part
    })
    nodes.push(<span key={`line-${i}`}>{formatted}</span>)
    if (i < lines.length - 1) nodes.push(<br key={`br2-${i}`} />)
  })
  return nodes
}

// AI Chat Message type
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// AIChatPanel - Floating AI chat assistant
function AIChatPanel() {
  const session = useAppStore((s) => s.session)
  const products = useAppStore((s) => s.products)
  const productSummary = useAppStore((s) => s.productSummary)
  const scanEvents = useAppStore((s) => s.scanEvents)

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Mark unread when panel is closed and new AI message arrives
  useEffect(() => {
    if (!isOpen && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      setHasUnread(true)
    }
  }, [messages, isOpen])

  const handleOpen = useCallback(() => {
    setIsOpen(true)
    setHasUnread(false)
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const context = {
        products: products.slice(0, 50).map((p) => ({
          code: p.code,
          description: p.description,
          status: p.status,
          totalScanned: p.totalScanned,
          totalRequested: p.totalRequested,
        })),
        summary: productSummary ? {
          total: productSummary.total,
          complete: productSummary.complete,
          partial: productSummary.partial,
          pending: productSummary.pending,
          missing: productSummary.missing,
          totalScanned: productSummary.totalScanned,
          totalRequested: productSummary.totalRequested,
        } : null,
        scanEvents: scanEvents.slice(-20).map((e) => ({
          productCode: e.productCode,
          assignedTo: e.assignedTo,
          createdAt: e.createdAt,
        })),
      }

      const history = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          sessionId: session?.id || '',
          context,
          history,
        }),
      })

      const data = await response.json()
      if (data.success && data.response) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.response }])
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Lo siento, no pude procesar su consulta. Intente nuevamente.' }])
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error de conexión. Verifique su conexión a internet e intente nuevamente.' }])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages, session, products, productSummary, scanEvents])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <>
      {/* Floating Chat Button */}
      <motion.div
        className="fixed bottom-6 right-6 z-50"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.5 }}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                onClick={isOpen ? () => setIsOpen(false) : handleOpen}
                className="relative h-14 w-14 rounded-full bg-gradient-to-br from-[#007BFF] to-[#339DFF] shadow-lg shadow-[#007BFF]/30 flex items-center justify-center text-white hover:shadow-xl hover:shadow-[#007BFF]/40 transition-shadow"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <AnimatePresence mode="wait">
                  {isOpen ? (
                    <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <XCircle className="h-6 w-6" />
                    </motion.div>
                  ) : (
                    <motion.div key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                      <MessageSquare className="h-6 w-6" />
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Pulse indicator for unread */}
                {hasUnread && !isOpen && (
                  <motion.span
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 border-2 border-white dark:border-slate-900"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                )}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isOpen ? 'Cerrar chat' : 'Asistente IA'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-48px)] h-[520px] max-h-[calc(100vh-140px)] flex flex-col glass-card rounded-2xl shadow-2xl border border-[#007BFF]/20 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#007BFF] to-[#339DFF] text-white">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                <span className="font-semibold text-sm">Asistente IA</span>
              </div>
              <Badge variant="secondary" className="text-[10px] bg-white/20 text-white border-white/30 hover:bg-white/30">
                Droguería Nena
              </Badge>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3">
                  <div className="h-12 w-12 rounded-full bg-[#007BFF]/10 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-[#007BFF]" />
                  </div>
                  <p className="text-sm font-medium">¡Hola! Soy su asistente IA</p>
                  <p className="text-xs max-w-[260px]">
                    Puedo ayudarle con consultas sobre el progreso del escaneo, productos faltantes, rendimiento de trabajadores y más.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1 justify-center">
                    {['¿Cuántos productos faltan?', 'Resumen del día', '¿Quién va más rápido?'].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q) }}
                        className="text-[10px] px-2.5 py-1 rounded-full bg-[#007BFF]/10 text-[#007BFF] hover:bg-[#007BFF]/20 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                  <div
                    className={`max-w-[280px] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#007BFF] text-white rounded-br-md'
                        : 'bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm text-foreground rounded-bl-md border border-[#007BFF]/10'
                    }`}
                  >
                    {msg.role === 'assistant' ? formatAIMessage(msg.content) : msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div className="h-7 w-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                    </div>
                  )}
                </motion.div>
              ))}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-2 justify-start"
                >
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center flex-shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="px-3 py-2.5 rounded-2xl rounded-bl-md bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-[#007BFF]/10">
                    <div className="flex items-center gap-1.5">
                      <motion.div className="h-1.5 w-1.5 rounded-full bg-[#007BFF]" animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} />
                      <motion.div className="h-1.5 w-1.5 rounded-full bg-[#007BFF]" animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.15 }} />
                      <motion.div className="h-1.5 w-1.5 rounded-full bg-[#007BFF]" animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.3 }} />
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-[#007BFF]/10 p-3 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Escriba su consulta..."
                  className="min-h-[38px] max-h-[80px] text-xs resize-none rounded-xl border-[#007BFF]/20 focus:border-[#007BFF] bg-white/80 dark:bg-slate-800/80"
                  rows={1}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  size="icon"
                  className="h-[38px] w-[38px] rounded-xl bg-gradient-to-br from-[#007BFF] to-[#339DFF] hover:from-[#0056b3] hover:to-[#007BFF] shadow-md shadow-[#007BFF]/20 flex-shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// WorkerSearchPanel - Search workers by code to see their product assignments
function WorkerSearchPanel() {
  const session = useAppStore((s) => s.session)
  const checkWorkerProduct = useAppStore((s) => s.checkWorkerProduct)
  const activeWorkerCode = useAppStore((s) => s.activeWorkerCode)
  const setActiveWorkerCode = useAppStore((s) => s.setActiveWorkerCode)
  const [workerSearch, setWorkerSearch] = useState('')
  const [workerResult, setWorkerResult] = useState<{
    code: string
    name: string
    itinerary: string
    rif: string
    assignments: Array<{
      id: string
      productCode: string
      productName: string
      quantity: number
      scannedQuantity: number
      pending: number
      status: string
      productStatus: string
    }>
    totalAssigned: number
    totalScanned: number
    totalProducts: number
    completedProducts: number
  } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [checkingCode, setCheckingCode] = useState<string | null>(null)
  const [workerList, setWorkerList] = useState<Array<{
    id: string
    code: string
    name: string
    itinerary: string
    totalProducts: number
    totalAssigned: number
    totalScanned: number
    completedProducts: number
  }>>([])
  const [showWorkerList, setShowWorkerList] = useState(false)

  const searchWorker = useCallback(async (code: string) => {
    if (!code.trim()) {
      setWorkerResult(null)
      return
    }
    setIsSearching(true)
    try {
      const params = new URLSearchParams({ code: code.trim() })
      if (session?.id) params.set('sessionId', session.id)
      const res = await fetch(`/api/workers?${params.toString()}`)
      const data = await res.json()
      if (data.success && data.worker) {
        setWorkerResult(data.worker)
        setActiveWorkerCode(data.worker.code)
      } else {
        setWorkerResult(null)
        setActiveWorkerCode(null)
        toast.error(data.error || `Trabajador "${code}" no encontrado`)
      }
    } catch {
      toast.error('Error al buscar trabajador')
    } finally {
      setIsSearching(false)
    }
  }, [session?.id, setActiveWorkerCode])

  const handleCheckProduct = useCallback(async (productCode: string) => {
    if (!workerResult || checkingCode) return
    setCheckingCode(productCode)
    try {
      const result = await checkWorkerProduct(workerResult.code, productCode)
      if (result?.success) {
        if (result.alreadyComplete) {
          toast.info('Este producto ya estaba completo')
        } else {
          toast.success(result.message || 'Producto chequeado')
          searchWorker(workerResult.code)
        }
      } else {
        toast.error(result?.message || 'Error al chequear producto')
      }
    } catch {
      toast.error('Error al chequear producto')
    } finally {
      setCheckingCode(null)
    }
  }, [workerResult, checkingCode, checkWorkerProduct, searchWorker])

  const loadAllWorkers = useCallback(async () => {
    if (!session?.id) return
    try {
      const params = new URLSearchParams({ sessionId: session.id })
      const res = await fetch(`/api/workers?${params.toString()}`)
      const data = await res.json()
      if (data.success && data.workers) {
        setWorkerList(data.workers)
        setShowWorkerList(true)
      }
    } catch {
      toast.error('Error al cargar trabajadores')
    }
  }, [session?.id])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      searchWorker(workerSearch)
    }
  }, [workerSearch, searchWorker])

  if (session?.status === 'closed') return null

  return (
    <motion.div {...fadeInUp}>
      <Card className="glass-card rounded-2xl overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Hash className="h-3 w-3 text-white" />
            </div>
            Buscar Trabajador
          </CardTitle>
          <CardDescription className="text-xs">
            Busque por código de trabajador para ver su pedido completo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Código de trabajador..."
                value={workerSearch}
                onChange={(e) => {
                  setWorkerSearch(e.target.value)
                  if (!e.target.value.trim()) {
                    setWorkerResult(null)
                    setActiveWorkerCode(null)
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                className="pl-8 h-8 text-xs rounded-xl border-amber-400/30 focus:border-amber-500"
              />
            </div>
            <Button
              onClick={() => searchWorker(workerSearch)}
              disabled={isSearching || !workerSearch.trim()}
              size="sm"
              className="h-8 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white text-xs"
            >
              {isSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            </Button>
          </div>

          {activeWorkerCode && (
            <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30 text-xs">
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-blue-700 dark:text-blue-400 font-medium">
                Modo trabajador activo: {activeWorkerCode}
              </span>
              <span className="text-muted-foreground">— escaneos solo para este trabajador</span>
              <button
                onClick={() => {
                  setWorkerSearch('')
                  setWorkerResult(null)
                  setActiveWorkerCode(null)
                }}
                className="ml-auto text-muted-foreground hover:text-red-500 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={loadAllWorkers}
            className="w-full h-7 text-xs rounded-xl text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
          >
            <Hash className="h-3 w-3 mr-1" />
            Ver todos los trabajadores
          </Button>

          {/* Worker Detail */}
          {workerResult && (
            <div className="space-y-2 p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-800/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{workerResult.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Código: {workerResult.code} • Itinerario: {workerResult.itinerary}
                  </p>
                </div>
                <Badge
                  variant={workerResult.completedProducts === workerResult.totalProducts ? "default" : "outline"}
                  className={`text-[10px] rounded-lg ${
                    workerResult.completedProducts === workerResult.totalProducts
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-300'
                      : ''
                  }`}
                >
                  {workerResult.completedProducts === workerResult.totalProducts ? (
                    <span className="flex items-center gap-0.5">
                      <CheckCircle2 className="h-3 w-3" /> Completo
                    </span>
                  ) : (
                    `${workerResult.completedProducts}/${workerResult.totalProducts} completos`
                  )}
                </Badge>
              </div>

              {/* Worker Complete Banner */}
              {workerResult.completedProducts === workerResult.totalProducts && workerResult.totalProducts > 0 && (
                <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-emerald-100/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/50 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Todos los productos chequeados - Trabajador Completo
                </div>
              )}

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Progreso</span>
                  <span>{workerResult.totalScanned}/{workerResult.totalAssigned} unidades</span>
                </div>
                <Progress
                  value={workerResult.totalAssigned > 0 ? Math.round((workerResult.totalScanned / workerResult.totalAssigned) * 100) : 0}
                  className="h-2"
                />
              </div>

              {/* Product list */}
              <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                {workerResult.assignments.map((a, i) => (
                  <div
                    key={`${a.productCode}-${i}`}
                    className="flex items-center justify-between py-1 px-2 rounded-lg text-xs hover:bg-white/50 dark:hover:bg-slate-800/50 group"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                        a.status === 'complete' ? 'bg-emerald-500' :
                        a.status === 'pending' ? 'bg-slate-300' :
                        a.status === 'assigned' ? 'bg-amber-400' :
                        'bg-red-500'
                      }`} />
                      <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">{a.productCode}</span>
                      <span className="truncate">{a.productName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      <span className="font-medium">
                        {a.scannedQuantity}/{a.quantity}
                      </span>
                      {a.status !== 'complete' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 w-5 p-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                          onClick={(e) => { e.stopPropagation(); handleCheckProduct(a.productCode) }}
                          disabled={checkingCode === a.productCode}
                          title="Chequear producto"
                        >
                          {checkingCode === a.productCode ? (
                            <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3 text-muted-foreground hover:text-emerald-600" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Worker List Dialog */}
          <Dialog open={showWorkerList} onOpenChange={setShowWorkerList}>
            <DialogContent className="glass-card rounded-2xl max-w-lg max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Hash className="h-5 w-5 text-amber-500" />
                  Trabajadores Registrados ({workerList.length})
                </DialogTitle>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar space-y-1">
                {workerList.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay trabajadores registrados. Cargue un PDF con notas de entrega.
                  </p>
                ) : (
                  workerList.map(w => (
                    <button
                      key={w.id}
                      onClick={() => {
                        setWorkerSearch(w.code)
                        searchWorker(w.code)
                        setShowWorkerList(false)
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-border/50 hover:bg-amber-50/50 dark:hover:bg-amber-950/10 transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm font-medium">{w.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Cod: {w.code} • It: {w.itinerary}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="text-xs font-medium">{w.completedProducts}/{w.totalProducts}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {w.totalScanned}/{w.totalAssigned} uds
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// AIAnalysisCard - AI Analysis card for sidebar
function AIAnalysisCard() {
  const session = useAppStore((s) => s.session)
  const productSummary = useAppStore((s) => s.productSummary)
  const [selectedType, setSelectedType] = useState<string>('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)
  const [analysisTitle, setAnalysisTitle] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const analysisTypes = [
    { value: 'summary', label: 'Resumen General', icon: BarChart3 },
    { value: 'missing_analysis', label: 'Análisis de Faltantes', icon: PackageX },
    { value: 'worker_performance', label: 'Rendimiento de Trabajadores', icon: Brain },
    { value: 'recommendations', label: 'Recomendaciones', icon: Sparkles },
  ]

  const handleAnalyze = useCallback(async (type: string) => {
    if (!session?.id || isAnalyzing) return

    const typeInfo = analysisTypes.find((t) => t.value === type)
    setAnalysisTitle(typeInfo?.label || 'Análisis')
    setIsAnalyzing(true)
    setDialogOpen(true)
    setAnalysisResult(null)

    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          type: type,
        }),
      })

      const data = await response.json()
      if (data.success && data.analysis) {
        setAnalysisResult(data.analysis)
      } else {
        setAnalysisResult('No se pudo generar el análisis. Intente nuevamente más tarde.')
      }
    } catch {
      setAnalysisResult('Error de conexión. Verifique su conexión e intente nuevamente.')
    } finally {
      setIsAnalyzing(false)
    }
  }, [session, isAnalyzing])

  if (!productSummary || productSummary.total === 0) {
    return null
  }

  return (
    <motion.div {...fadeInUp}>
      <Card className="glass-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
              <Brain className="h-3 w-3 text-white" />
            </div>
            Análisis IA
          </CardTitle>
          <CardDescription className="text-xs">
            Obtenga análisis inteligente de su progreso de escaneo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={selectedType} onValueChange={(val) => setSelectedType(val)}>
            <SelectTrigger className="w-full h-8 text-xs rounded-xl border-[#007BFF]/20">
              <Sparkles className="h-3 w-3 mr-1 text-[#007BFF]" />
              <SelectValue placeholder="Seleccione análisis..." />
            </SelectTrigger>
            <SelectContent>
              {analysisTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  <div className="flex items-center gap-2">
                    <type.icon className="h-3 w-3" />
                    {type.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={() => selectedType && handleAnalyze(selectedType)}
            disabled={!selectedType || isAnalyzing}
            className="w-full bg-gradient-to-r from-[#007BFF] to-[#339DFF] hover:from-[#0056b3] hover:to-[#007BFF] text-white rounded-xl shadow-md shadow-[#007BFF]/20 h-9 text-xs"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                Analizando...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-2" />
                Generar Análisis
              </>
            )}
          </Button>

          {/* Quick analysis buttons */}
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {analysisTypes.slice(0, 4).map((type) => (
              <motion.button
                key={type.value}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleAnalyze(type.value)}
                disabled={isAnalyzing}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-[#007BFF]/5 hover:bg-[#007BFF]/10 text-[#007BFF] border border-[#007BFF]/10 transition-colors disabled:opacity-50"
              >
                <type.icon className="h-3 w-3" />
                {type.label.split(' ').slice(0, 2).join(' ')}
              </motion.button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Analysis Result Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-card rounded-2xl max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#007BFF]" />
              {analysisTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] pr-2 scrollbar-thin">
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <motion.div
                  className="h-10 w-10 rounded-full bg-[#007BFF]/10 flex items-center justify-center"
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                >
                  <Brain className="h-5 w-5 text-[#007BFF]" />
                </motion.div>
                <p className="text-sm text-muted-foreground">Generando análisis...</p>
                <div className="w-32">
                  <Progress value={66} className="h-1.5" />
                </div>
              </div>
            ) : analysisResult ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm leading-relaxed space-y-2"
              >
                {formatAIMessage(analysisResult).map((node, i) => (
                  <React.Fragment key={i}>{node}</React.Fragment>
                ))}
              </motion.div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

// Product Row Component
function ProductRow({ product }: { product: ProductData }) {
  const assignments = useAppStore((s) => s.assignmentsMap[product.code])
  const [isOpen, setIsOpen] = useState(false)
  const fetchAssignments = useAppStore((s) => s.fetchAssignments)
  const manualScan = useAppStore((s) => s.manualScan)
  const isScanning = useAppStore((s) => s.isScanning)
  const session = useAppStore((s) => s.session)

  // Manual quantity dialog state
  const [showManualDialog, setShowManualDialog] = useState(false)
  const [manualQty, setManualQty] = useState(1)
  const [isManualScanning, setIsManualScanning] = useState(false)

  const progressPercent = product.totalRequested > 0
    ? Math.round((product.totalScanned / product.totalRequested) * 100)
    : 0

  const remaining = product.totalRequested - product.totalScanned
  const isComplete = product.status === 'complete' || remaining <= 0

  const handleToggle = async () => {
    const newState = !isOpen
    setIsOpen(newState)
    if (newState && !assignments) {
      await fetchAssignments(product.code)
    }
  }

  const handleManualScan = async () => {
    if (manualQty < 1 || isComplete) return
    setIsManualScanning(true)
    try {
      const result = await manualScan(product.code, manualQty)
      if (result) {
        if (result.status === 'assigned' || result.status === 'scanned_unassigned') {
          const count = result.scannedCount || manualQty
          toast.success(`${count} unidad(es) de ${product.code} registrada(s)`, {
            description: product.description,
          })
          playSuccessSound()
        } else if (result.status === 'already_complete') {
          toast.warning(`Producto ${product.code} ya está completo`)
          playAlertSound()
        } else if (result.status === 'not_found') {
          toast.warning(`Producto ${product.code} no encontrado en la lista`)
          playAlertSound()
        } else {
          toast.info(result.message || `Producto ${product.code} procesado`)
        }
        setShowManualDialog(false)
        setManualQty(1)
      } else {
        toast.error('Error al procesar el escaneo manual')
        playAlertSound()
      }
    } catch {
      toast.error('Error de conexión al procesar escaneo manual')
      playAlertSound()
    } finally {
      setIsManualScanning(false)
    }
  }

  const handleManualButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setManualQty(1)
    setShowManualDialog(true)
  }

  // Quick-fill: set qty to remaining
  const handleFillRemaining = () => {
    setManualQty(remaining > 0 ? remaining : 1)
  }

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={handleToggle}>
        <motion.div
          key={`product-${product.code}-${product.status}`}
          animate={statusTransition}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-l-4 ${getStatusBorderColor(product.status)} ${getStatusBgColor(product.status)} transition-all duration-200 hover:shadow-md cursor-pointer group`}
          onClick={() => handleToggle()}
        >
          {/* Status Icon */}
          <div className="flex-shrink-0">
            {getStatusIcon(product.status)}
          </div>

          {/* Product Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-semibold text-foreground">{product.code}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-md">
                B{product.bulto}
              </Badge>
              {product.origen && product.origen !== 'R' && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-md">
                  {product.origen}
                </Badge>
              )}
              {product._count?.assignments != null && (
                <Badge
                  variant={product._count.assignments > 0 ? 'secondary' : 'outline'}
                  className={`text-[10px] px-1.5 py-0 rounded-md ${
                    product._count.assignments > 0
                      ? 'bg-[#007BFF]/10 text-[#007BFF] border-[#007BFF]/20'
                      : 'text-amber-500 border-amber-300/50'
                  }`}
                >
                  {product._count.assignments > 0
                    ? `${product._count.assignments} asig.`
                    : 'Sin asig.'}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{product.description}</p>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-20">
              <Progress value={progressPercent} className="h-1.5" />
            </div>
            <span className="text-xs font-mono font-medium min-w-[3rem] text-right">
              {product.totalScanned}/{product.totalRequested}
            </span>
          </div>

          {/* Manual Add Button */}
          {session?.status === 'active' && !isComplete && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleManualButtonClick}
                    className="h-7 w-7 rounded-lg hover:bg-[#007BFF]/10 hover:text-[#007BFF] transition-colors"
                  >
                    <PlusCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Agregar cantidad manualmente
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Expand */}
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
              {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </CollapsibleTrigger>
        </motion.div>

        <CollapsibleContent>
          <div className="ml-6 mr-2 mt-1 mb-2 space-y-1">
            {assignments ? (
              assignments.length > 0 ? (
                assignments.map((a: AssignmentData) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.worker.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 rounded-md">
                        Cod. {a.worker.code}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 rounded-md">
                        It. {a.worker.itinerary}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {a.scannedQuantity}/{a.quantity}
                      </span>
                      <div className={`h-2 w-2 rounded-full ${getStatusColor(a.status === 'complete' ? 'complete' : a.scannedQuantity > 0 ? 'partial' : 'pending')}`} />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground italic px-3 py-1.5">Sin asignación específica — producto general (no asociado a un trabajador en particular)</p>
              )
            ) : (
              <div className="flex items-center gap-2 px-3 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-[#007BFF]" />
                <span className="text-xs text-muted-foreground">Cargando asignaciones...</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Manual Quantity Dialog */}
      <AlertDialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <AlertDialogContent className="glass-card rounded-2xl max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
                <Hash className="h-4 w-4 text-white" />
              </div>
              Agregar Cantidad Manual
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-2">
              <span className="font-mono font-semibold text-foreground">{product.code}</span>
              <span className="text-muted-foreground"> — </span>
              <span className="text-foreground">{product.description}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-3 text-xs px-1">
            <span className="text-muted-foreground">
              Escaneado: <span className="font-semibold text-foreground">{product.totalScanned}</span>
            </span>
            <span className="text-muted-foreground">
              Solicitado: <span className="font-semibold text-foreground">{product.totalRequested}</span>
            </span>
            <span className="text-muted-foreground">
              Falta: <span className="font-semibold text-amber-600">{remaining}</span>
            </span>
          </div>

          {/* Quantity Selector */}
          <div className="py-4">
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setManualQty(Math.max(1, manualQty - 1))}
                disabled={manualQty <= 1}
                className="h-12 w-12 rounded-xl text-lg font-bold"
              >
                <Minus className="h-5 w-5" />
              </Button>
              <div className="flex flex-col items-center">
                <Input
                  type="number"
                  min={1}
                  max={remaining}
                  value={manualQty}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1
                    setManualQty(Math.max(1, Math.min(val, remaining)))
                  }}
                  className="w-24 h-14 text-center text-2xl font-bold rounded-xl border-2 border-[#007BFF]/30 focus:border-[#007BFF]"
                />
                <span className="text-[10px] text-muted-foreground mt-1">
                  máx: {remaining}
                </span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setManualQty(Math.min(remaining, manualQty + 1))}
                disabled={manualQty >= remaining}
                className="h-12 w-12 rounded-xl text-lg font-bold"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>

            {/* Quick quantity buttons */}
            <div className="flex items-center justify-center gap-2 mt-3">
              {[1, 2, 5, 10, remaining].filter((v, i, a) => v > 0 && a.indexOf(v) === i && v !== manualQty).slice(0, 4).map((qty) => (
                <Button
                  key={qty}
                  variant="outline"
                  size="sm"
                  onClick={() => setManualQty(qty)}
                  className="h-7 px-3 rounded-lg text-xs"
                >
                  {qty}
                </Button>
              ))}
              {remaining > 1 && remaining !== manualQty && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFillRemaining}
                  className="h-7 px-3 rounded-lg text-xs text-[#007BFF] border-[#007BFF]/30 hover:bg-[#007BFF]/10"
                >
                  Todo ({remaining})
                </Button>
              )}
            </div>
          </div>

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl" disabled={isManualScanning}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleManualScan}
              disabled={isManualScanning || manualQty < 1}
              className="bg-gradient-to-r from-[#007BFF] to-[#339DFF] hover:from-[#0056b3] hover:to-[#007BFF] text-white rounded-xl"
            >
              {isManualScanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Procesando...
                </>
              ) : (
                <>
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Agregar {manualQty} unidad{manualQty !== 1 ? 'es' : ''}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Product List Component
function ProductList() {
  const products = useAppStore((s) => s.products)
  const productSummary = useAppStore((s) => s.productSummary)
  const isLoading = useAppStore((s) => s.isLoading)
  const scanBarcode = useAppStore((s) => s.scanBarcode)
  const session = useAppStore((s) => s.session)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('code')
  const [groupByBulto, setGroupByBulto] = useState(false)

  // Manual barcode entry state
  const [manualBarcode, setManualBarcode] = useState('')
  const [isManualScanning, setIsManualScanning] = useState(false)
  const manualInputRef = useRef<HTMLInputElement>(null)

  const handleManualBarcodeSubmit = useCallback(async () => {
    const barcode = manualBarcode.trim()
    if (!barcode || isManualScanning) return

    setIsManualScanning(true)
    try {
      const result = await scanBarcode(barcode)
      if (result) {
        if (result.status === 'assigned' || result.status === 'scanned_unassigned') {
          const count = result.scannedCount || 1
          const workerInfo = result.assignment?.workerName
            ? ` → ${result.assignment.workerName}`
            : result.allAssignments?.length
              ? ` → ${result.allAssignments[0].workerName}`
              : ''
          toast.success(`✓ ${barcode}: ${count} unidad(es) registrada(s)${workerInfo}`)
          playSuccessSound()
        } else if (result.status === 'already_complete') {
          toast.warning(`Producto ${barcode} ya está completo`)
          playAlertSound()
        } else if (result.status === 'not_found') {
          toast.error(`Producto ${barcode} no encontrado en la lista`)
          playAlertSound()
        }
      }
      setManualBarcode('')
      // Keep focus on input for continuous scanning
      setTimeout(() => manualInputRef.current?.focus(), 100)
    } catch {
      toast.error('Error de conexión al escanear')
      playAlertSound()
    } finally {
      setIsManualScanning(false)
    }
  }, [manualBarcode, isManualScanning, scanBarcode])

  const handleManualBarcodeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleManualBarcodeSubmit()
    }
  }, [handleManualBarcodeSubmit])

  const filteredProducts = useMemo(() => {
    let result = [...products]

    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter)
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result.filter(
        (p) =>
          p.code.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term)
      )
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'code':
          return a.code.localeCompare(b.code, undefined, { numeric: true })
        case 'status': {
          const order = { pending: 0, partial: 1, missing: 2, complete: 3 }
          return (order[a.status as keyof typeof order] ?? 0) - (order[b.status as keyof typeof order] ?? 0)
        }
        case 'bulto':
          return a.bulto - b.bulto
        case 'progress':
          return (b.totalScanned / b.totalRequested) - (a.totalScanned / a.totalRequested)
        default:
          return 0
      }
    })

    return result
  }, [products, statusFilter, searchTerm, sortBy])

  const groupedProducts = useMemo(() => {
    if (!groupByBulto) return null
    const groups: Record<number, ProductData[]> = {}
    for (const p of filteredProducts) {
      if (!groups[p.bulto]) groups[p.bulto] = []
      groups[p.bulto].push(p)
    }
    return groups
  }, [filteredProducts, groupByBulto])

  // Skeleton loading state
  if (isLoading && products.length === 0) {
    return (
      <Card className="flex-1 glass-card rounded-2xl">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-4 w-32 rounded-lg" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24 rounded-lg" />
                <Skeleton className="h-2.5 w-48 rounded-lg" />
              </div>
              <Skeleton className="h-2 w-20 rounded-full" />
              <Skeleton className="h-3 w-10 rounded-lg" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <motion.div {...fadeInUp} className="flex-1">
      <Card className="glass-card rounded-2xl flex flex-col h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
                <ClipboardList className="h-3 w-3 text-white" />
              </div>
              Lista de Productos
              {productSummary && (
                <Badge variant="outline" className="text-xs font-normal rounded-lg">
                  {productSummary.total} productos
                </Badge>
              )}
            </CardTitle>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap gap-2 mt-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por código o descripción..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs rounded-xl border-[#007BFF]/20 focus:border-[#007BFF]"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="partial">Parciales</SelectItem>
                <SelectItem value="complete">Completos</SelectItem>
                <SelectItem value="missing">Faltantes</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[120px] h-8 text-xs rounded-xl">
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="code">Por código</SelectItem>
                <SelectItem value="status">Por estado</SelectItem>
                <SelectItem value="bulto">Por bulto</SelectItem>
                <SelectItem value="progress">Por progreso</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Switch
                id="group-bulto"
                checked={groupByBulto}
                onCheckedChange={setGroupByBulto}
                className="scale-75"
              />
              <Label htmlFor="group-bulto" className="text-xs text-muted-foreground">
                Agrupar por bulto
              </Label>
            </div>
          </div>

          {/* Manual Barcode Entry */}
          {session?.status === 'active' && products.length > 0 && (
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Scan className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#007BFF]" />
                <Input
                  ref={manualInputRef}
                  placeholder="Escanear código manualmente..."
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value)}
                  onKeyDown={handleManualBarcodeKeyDown}
                  disabled={isManualScanning}
                  className="pl-8 h-9 text-sm rounded-xl border-[#007BFF]/30 focus:border-[#007BFF] bg-[#007BFF]/5 font-mono"
                />
              </div>
              <Button
                onClick={handleManualBarcodeSubmit}
                disabled={isManualScanning || !manualBarcode.trim()}
                className="h-9 px-4 rounded-xl bg-gradient-to-r from-[#007BFF] to-[#339DFF] hover:from-[#0056b3] hover:to-[#007BFF] text-white shadow-md shadow-[#007BFF]/20"
              >
                {isManualScanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Scan className="h-4 w-4 mr-1.5" />
                    Escanear
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Total scanned units summary */}
          {productSummary && productSummary.total > 0 && (
            <div className="mt-2 flex items-center gap-3 px-1">
              <span className="text-xs text-muted-foreground font-medium">
                Total unidades escaneadas:
              </span>
              <span className="text-xs font-bold text-[#007BFF]">
                {productSummary.totalScanned}/{productSummary.totalRequested}
              </span>
              <Progress
                value={productSummary.totalRequested > 0 ? (productSummary.totalScanned / productSummary.totalRequested) * 100 : 0}
                className="h-1.5 flex-1"
              />
              <span className="text-[10px] text-muted-foreground font-medium">
                {productSummary.totalRequested > 0 ? Math.round((productSummary.totalScanned / productSummary.totalRequested) * 100) : 0}%
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 p-3 pt-0">
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-[#007BFF]/20 mb-3" />
              <p className="text-sm text-muted-foreground">
                {products.length === 0
                  ? 'No hay productos. Cargue los archivos del día.'
                  : 'No se encontraron productos con los filtros seleccionados.'}
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[calc(100vh-420px)] min-h-[300px] custom-scrollbar">
              <div className="space-y-1.5">
                {groupByBulto && groupedProducts ? (
                  Object.entries(groupedProducts)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([bulto, prods]) => (
                      <div key={bulto} className="mb-3">
                        <div className="flex items-center gap-2 mb-1 px-1">
                          <Badge variant="secondary" className="text-xs font-semibold rounded-lg">
                            Bulto {bulto}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {prods.length} producto{prods.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {prods.map((p) => (
                            <ProductRow key={p.id} product={p} />
                          ))}
                        </div>
                      </div>
                    ))
                ) : (
                  filteredProducts.map((p) => (
                    <ProductRow key={p.id} product={p} />
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Scan Notification Popup
function ScanNotification({ scan, onDismiss }: { scan: ScanResult; onDismiss: () => void }) {
  const isSuccess = scan.status === 'assigned' || scan.status === 'scanned_unassigned'
  const isAlreadyComplete = scan.status === 'already_complete'
  const isNotFound = scan.status === 'not_found'

  useEffect(() => {
    // Play audio feedback
    if (isSuccess) {
      playSuccessSound()
    } else if (isNotFound || isAlreadyComplete) {
      playAlertSound()
    }
  }, [isSuccess, isNotFound, isAlreadyComplete])

  useEffect(() => {
    const timer = setTimeout(onDismiss, 4500)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <motion.div
      {...slideInRight}
      className={`pointer-events-auto rounded-2xl shadow-xl border p-4 max-w-sm backdrop-blur-lg ${
        isSuccess
          ? 'bg-emerald-50/90 dark:bg-emerald-950/60 border-emerald-200/60 dark:border-emerald-800/60 glow-success'
          : isAlreadyComplete
            ? 'bg-amber-50/90 dark:bg-amber-950/60 border-amber-200/60 dark:border-amber-800/60 glow-warning'
            : 'bg-red-50/90 dark:bg-red-950/60 border-red-200/60 dark:border-red-800/60 glow-danger'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <motion.div
          animate={isSuccess ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 0.3 }}
          className="flex-shrink-0 mt-0.5"
        >
          {isSuccess ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : isAlreadyComplete ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
        </motion.div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {isSuccess
              ? scan.scannedCount && scan.scannedCount > 1
                ? `${scan.scannedCount} uds. de ${scan.product?.code} registradas`
                : `Producto ${scan.product?.code} escaneado`
              : isAlreadyComplete
                ? `Producto ${scan.product?.code} ya completo`
                : scan.barcode
                  ? `Código ${scan.barcode} no encontrado`
                  : 'Error de escaneo'}
          </p>
          {scan.product && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {scan.product.description}
            </p>
          )}
          {scan.assignment && (
            <div className="mt-1.5 text-xs space-y-0.5">
              <p className="text-emerald-700 dark:text-emerald-400 font-medium">
                → <span className="font-semibold">{scan.assignment.workerName}</span> (Cod. {scan.assignment.workerCode}) — It. {scan.assignment.itinerary}
              </p>
              <p className="text-muted-foreground">
                Progreso: {scan.assignment.scannedQuantity}/{scan.assignment.quantity}
                {scan.assignment.allocatedQuantity && scan.assignment.allocatedQuantity > 1 && (
                  <span className="text-emerald-600 dark:text-emerald-400"> (+{scan.assignment.allocatedQuantity} uds.)</span>
                )}
              </p>
            </div>
          )}
          {scan.otherWorkerProducts && scan.otherWorkerProducts.length > 0 && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              <p>Otros productos del trabajador:</p>
              {scan.otherWorkerProducts.slice(0, 3).map((p, i) => (
                <p key={i}>• {p.productCode} - {p.productDescription} ({p.scannedQuantity}/{p.quantity})</p>
              ))}
              {scan.otherWorkerProducts.length > 3 && (
                <p>... y {scan.otherWorkerProducts.length - 3} más</p>
              )}
            </div>
          )}
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <XCircle className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  )
}

// Recent Scans List
function RecentScansPanel() {
  const scanEvents = useAppStore((s) => s.scanEvents)

  return (
    <motion.div {...fadeInUp}>
      <Card className="glass-card rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
              <Scan className="h-3 w-3 text-white" />
            </div>
            Últimos Escaneos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scanEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No hay escaneos registrados
            </p>
          ) : (
            <ScrollArea className="max-h-48 custom-scrollbar">
              <div className="space-y-1.5">
                {scanEvents.slice(0, 10).map((event, idx) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ScanLine className="h-3 w-3 text-[#007BFF] flex-shrink-0" />
                      <span className="font-mono font-medium">{event.productCode}</span>
                      {event.assignedTo && (
                        <span className="text-muted-foreground truncate">
                          → {event.assignedTo}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground flex-shrink-0 ml-2">
                      {new Date(event.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </motion.div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Report View
function ReportView() {
  const report = useAppStore((s) => s.report)
  const fetchReport = useAppStore((s) => s.fetchReport)
  const session = useAppStore((s) => s.session)

  // Track whether we've already attempted to fetch the report to prevent infinite loops
  // if fetchReport() returns null/undefined (e.g. API error or empty response)
  const fetchReportAttemptedRef = useRef(false)

  useEffect(() => {
    if (session?.status === 'closed' && !fetchReportAttemptedRef.current) {
      fetchReportAttemptedRef.current = true
      fetchReport()
    }
    // Reset when session is no longer closed (e.g. new session started)
    if (session?.status !== 'closed') {
      fetchReportAttemptedRef.current = false
    }
  }, [session?.status, fetchReport])

  const isLoading = !report && session?.status === 'closed'

  const handleExportCSV = () => {
    if (!report) return

    const headers = ['Código', 'Descripción', 'Solicitado', 'Escaneado', 'Faltante', 'Estado', 'Bulto', 'Trabajador', 'Itinerario', 'Cantidad Trab.', 'Escaneado Trab.']
    const rows = report.missingItems.flatMap((item) => {
      if (item.assignments.length === 0) {
        return [[item.code, item.description, item.totalRequested, item.totalScanned, item.missing, item.status, item.bulto, '', '', '', '']]
      }
      return item.assignments.map((a) => [
        item.code, item.description, item.totalRequested, item.totalScanned, item.missing, item.status, item.bulto,
        a.workerName, a.itinerary, a.quantity, a.scannedQuantity,
      ])
    })

    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.map((c) => `"${c}"`).join(',')),
    ].join('\n')

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_faltantes_${session?.date || 'session'}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Reporte exportado exitosamente')
  }

  if (isLoading) {
    return (
      <Card className="flex-1 glass-card rounded-2xl">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-[#007BFF]" />
            <p className="text-sm text-muted-foreground">Generando reporte...</p>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!report) return null

  const { summary, missingItems } = report

  return (
    <motion.div {...fadeInUp} className="flex-1">
      <Card className="glass-card rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-white" />
              </div>
              Reporte de Faltantes — {formatDate(summary.sessionDate)}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5 rounded-xl">
              <FileDown className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          </div>
          <CardDescription>
            Resumen de la sesión de escaneo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0 }}
              className="text-center p-4 rounded-xl bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm"
            >
              <p className="text-2xl font-bold">{summary.totalProducts}</p>
              <p className="text-xs text-muted-foreground">Total Productos</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="text-center p-4 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/20"
            >
              <p className="text-2xl font-bold text-emerald-600">{summary.completeProducts}</p>
              <p className="text-xs text-muted-foreground">Completos</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-center p-4 rounded-xl bg-red-50/80 dark:bg-red-950/20"
            >
              <p className="text-2xl font-bold text-red-600">{summary.missingProducts + summary.partialProducts + summary.pendingProducts}</p>
              <p className="text-xs text-muted-foreground">Faltantes</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="text-center p-4 rounded-xl bg-[#007BFF]/5 dark:bg-[#007BFF]/10"
            >
              <p className="text-2xl font-bold text-[#007BFF]">{summary.completionPercentage}%</p>
              <p className="text-xs text-muted-foreground">Cumplimiento</p>
            </motion.div>
          </div>

          <Separator />

          {/* Missing Items */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <PackageX className="h-4 w-4 text-red-500" />
              Productos Faltantes
              <Badge variant="destructive" className="text-[10px]">
                {missingItems.length}
              </Badge>
            </h3>
            <ScrollArea className="max-h-[400px] custom-scrollbar">
              <div className="space-y-1.5">
                {missingItems.map((item) => (
                  <div
                    key={item.code}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-red-50/60 dark:bg-red-950/15 border border-red-200/30 dark:border-red-800/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold">{item.code}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-md">B{item.bulto}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-red-600">
                          {item.missing} faltante{item.missing !== 1 ? 's' : ''}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {item.totalScanned}/{item.totalRequested}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Saved Session View ─────────────────────────────────────────────

function SavedSessionView() {
  const session = useAppStore((s) => s.session)
  const products = useAppStore((s) => s.products)
  const productSummary = useAppStore((s) => s.productSummary)
  const resumeSession = useAppStore((s) => s.resumeSession)
  const finalizeSession = useAppStore((s) => s.finalizeSession)
  const isResuming = useAppStore((s) => s.isResuming)
  const isFinalizing = useAppStore((s) => s.isFinalizing)
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)

  const handleResume = async () => {
    if (!session) return
    const success = await resumeSession(session.id)
    if (success) {
      toast.success('¡Jornada reanudada! Continúe escaneando los productos pendientes.')
    } else {
      toast.error('Error al reanudar la sesión')
    }
  }

  const handleFinalize = async () => {
    const success = await finalizeSession()
    if (success) {
      toast.success('Sesión finalizada exitosamente')
      setShowFinalizeDialog(false)
    } else {
      toast.error('Error al finalizar la sesión')
    }
  }

  const pendingCount = productSummary ? productSummary.pending + productSummary.partial : 0

  return (
    <motion.div {...fadeInUp} className="max-w-lg mx-auto mt-8">
      <Card className="glass-card rounded-2xl overflow-hidden">
        <CardHeader className="text-center pb-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/25"
          >
            <Save className="h-8 w-8 text-white" />
          </motion.div>
          <CardTitle className="text-xl">Jornada Guardada</CardTitle>
          <CardDescription className="text-sm">
            Esta jornada tiene <span className="font-semibold text-amber-600">{pendingCount}</span> producto{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''} o parcial{pendingCount !== 1 ? 'es' : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary stats */}
          {productSummary && (
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="p-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/20">
                <p className="text-2xl font-bold text-emerald-600">{productSummary.complete}</p>
                <p className="text-xs text-muted-foreground">Completos</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/20">
                <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Pendientes</p>
              </div>
              <div className="p-3 rounded-xl bg-red-50/80 dark:bg-red-950/20">
                <p className="text-2xl font-bold text-red-600">{productSummary.missing}</p>
                <p className="text-xs text-muted-foreground">Faltantes</p>
              </div>
            </div>
          )}

          <Separator />

          <p className="text-xs text-muted-foreground text-center">
            Al reanudar, podrá escanear solo los productos pendientes sin perder el progreso ya realizado.
          </p>

          {/* Action buttons */}
          <div className="space-y-2">
            <Button
              onClick={handleResume}
              disabled={isResuming}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl h-11 shadow-md shadow-emerald-500/20"
            >
              {isResuming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Reanudando...
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Reanudar Jornada
                </>
              )}
            </Button>

            <AlertDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full rounded-xl h-11 border-red-200 hover:bg-red-50 hover:border-red-300 text-red-600 dark:border-red-800/50 dark:hover:bg-red-950/20">
                  <Lock className="h-4 w-4 mr-2" />
                  Finalizar y Marcar Faltantes
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="glass-card rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Finalizar sesión?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se marcarán {pendingCount} producto{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}/parcial{pendingCount !== 1 ? 'es' : ''} como &quot;Faltante&quot;. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleFinalize}
                    disabled={isFinalizing}
                    className="bg-red-600 hover:bg-red-700 rounded-xl"
                  >
                    {isFinalizing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Finalizando...
                      </>
                    ) : (
                      'Finalizar Sesión'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────

export function ChequeoRutaChicaApp({ userName, onLogout, isLoggingOut }: { userName?: string; onLogout?: () => void; isLoggingOut?: boolean } = {}) {
  const session = useAppStore((s) => s.session)
  const fetchSession = useAppStore((s) => s.fetchSession)
  const fetchProducts = useAppStore((s) => s.fetchProducts)
  const fetchRecentScans = useAppStore((s) => s.fetchRecentScans)
  const lastScan = useAppStore((s) => s.lastScan)
  const initSocket = useAppStore((s) => s.initSocket)
  const disconnectSocket = useAppStore((s) => s.disconnectSocket)
  const products = useAppStore((s) => s.products)
  const productSummary = useAppStore((s) => s.productSummary)
  const [activeNotification, setActiveNotification] = useState<ScanResult | null>(null)
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { isListening } = useScanner()

  // Initialize on mount (once only)
  const hasInitializedRef = useRef(false)
  useEffect(() => {
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true
    const init = async () => {
      await fetchSession()
      initSocket()
    }
    init()
    return () => {
      disconnectSocket()
    }
  }, [])

  // Track which session ID we've loaded data for
  const loadedSessionRef = useRef<string | null>(null)
  const sessionId = session?.id
  
  // Load data when session ID changes (use sessionId instead of session to avoid reference-based re-triggers)
  useEffect(() => {
    if (sessionId && loadedSessionRef.current !== sessionId) {
      loadedSessionRef.current = sessionId
      fetchProducts()
      fetchRecentScans()
    }
  }, [sessionId, fetchProducts, fetchRecentScans])

  // Show notification when a new scan occurs
  const [notificationPending, startNotificationTransition] = React.useTransition()
  
  useEffect(() => {
    if (lastScan) {
      startNotificationTransition(() => {
        setActiveNotification(lastScan)
      })
      // Clear any existing timer
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current)
      }
      // Auto-dismiss after 4.5 seconds
      notificationTimerRef.current = setTimeout(() => {
        startNotificationTransition(() => {
          setActiveNotification(null)
        })
      }, 4500)
    }
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current)
      }
    }
  }, [lastScan])

  const dismissNotification = useCallback(() => {
    setActiveNotification(null)
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current)
    }
  }, [])

  const isSessionClosed = session?.status === 'closed'
  const isSessionSaved = session?.status === 'saved'

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/30">
      {/* Header */}
      <AppHeader userName={userName} onLogout={onLogout} isLoggingOut={isLoggingOut} />

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-4">
        {isSessionClosed && products.length > 0 ? (
          /* Report View when session is closed */
          <ReportView />
        ) : isSessionSaved ? (
          /* Saved Session View - offers Reanudar or Finalizar */
          <SavedSessionView />
        ) : (
          /* Normal operational view */
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            {/* Left Sidebar */}
            <div className="space-y-4">
              <UploadPanel />
              <WorkerSearchPanel />
              <QuickStats />
              <AIAnalysisCard />
              <RecentScansPanel />
            </div>

            {/* Right Main Content */}
            <ProductList />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border/50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-[#007BFF]" />
              <span className="font-medium">Chequeo Ruta Chica</span>
              <span>•</span>
              <span>Droguería Nena</span>
            </div>
            <div className="flex items-center gap-3">
              {isListening && (
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Escáner activo
                </span>
              )}
              {productSummary && productSummary.total > 0 && (
                <span>
                  Progreso: {productSummary.complete}/{productSummary.total} ({Math.round((productSummary.complete / productSummary.total) * 100)}%)
                </span>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* Scan Notifications (floating) */}
      <div className="fixed top-20 right-4 z-50 pointer-events-none">
        <AnimatePresence>
          {activeNotification && (
            <ScanNotification
              scan={activeNotification}
              onDismiss={dismissNotification}
            />
          )}
        </AnimatePresence>
      </div>

      {/* AI Chat Panel (floating) */}
      <AIChatPanel />
    </div>
  )
}
