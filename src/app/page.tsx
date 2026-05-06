'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, Upload, ScanLine, CheckCircle2, AlertTriangle,
  XCircle, Search, Filter, BarChart3, FileDown,
  ChevronDown, ChevronUp, RefreshCw, Lock, Sun, Moon,
  PackageCheck, PackageX, ClipboardList,
  FileSpreadsheet, FileText, Loader2, Scan, CircleDot,
  RotateCcw, Zap, Eye, Sparkles, Volume2, VolumeX
} from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'

import { useAppStore, type ProductData, type AssignmentData, type ScanResult, type ReportData } from '@/lib/store'
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

// ─── Animation Variants ──────────────────────────────────────────────

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }
}

const scaleIn = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
  transition: { duration: 0.2, ease: 'easeOut' }
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
  transition: { type: 'spring', damping: 25, stiffness: 300 }
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
function AppHeader() {
  const { session, isSocketConnected, isScannerListening, fetchProducts, products, productSummary } = useAppStore()
  const { theme, setTheme } = useTheme()
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const isFinalizing = useAppStore((s) => s.isFinalizing)
  const isResetting = useAppStore((s) => s.isResetting)
  const finalizeSession = useAppStore((s) => s.finalizeSession)
  const resetSession = useAppStore((s) => s.resetSession)

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
        <div className="flex items-center justify-between gap-4 flex-wrap">
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
          <div className="flex items-center gap-4 flex-1 justify-center">
            {session && (
              <div className="flex items-center gap-3">
                <Badge 
                  variant={session.status === 'active' ? 'default' : 'destructive'} 
                  className="text-xs font-medium"
                >
                  {session.status === 'active' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Activa
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
          <div className="flex items-center gap-2">
            {/* Scanner Status */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm">
                    <div className={`h-2 w-2 rounded-full transition-colors ${isScannerListening ? 'bg-emerald-500 animate-pulse' : isSocketConnected ? 'bg-amber-400' : 'bg-red-500'}`} />
                    <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {isScannerListening ? 'Escáner activo - Escuchando' : isSocketConnected ? 'Escáner conectado - En espera' : 'Escáner desconectado'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

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

            {/* Finalize */}
            {session?.status === 'active' && products.length > 0 && (
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
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

// Upload Panel Component
function UploadPanel() {
  const { uploadFiles, isUploading, session, ocrMethod, ocrConfidence } = useAppStore()
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
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
    if (!excelFile || !pdfFile) {
      toast.error('Debe seleccionar ambos archivos')
      return
    }
    const result = await uploadFiles(excelFile, pdfFile)
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

    const file = e.dataTransfer.files[0]
    if (!file) return

    if (type === 'excel') {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setExcelFile(file)
      } else {
        toast.error('El archivo Excel debe ser .xlsx o .xls')
      }
    } else {
      if (file.name.endsWith('.pdf')) {
        setPdfFile(file)
      } else {
        toast.error('El archivo PDF debe ser .pdf')
      }
    }
  }

  if (session?.status === 'closed') {
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
            Suba el archivo Excel con los productos y el PDF con las asignaciones. El PDF se procesa con OCR automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Excel Input */}
          <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${
              isDraggingExcel 
                ? 'border-[#007BFF] bg-[#007BFF]/5 dark:bg-[#007BFF]/10' 
                : excelFile 
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
              className="hidden"
              onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
            />
            <FileSpreadsheet className="h-6 w-6 mx-auto mb-1.5 text-emerald-500" />
            <p className="text-xs font-medium">
              {excelFile ? excelFile.name : 'Archivo Excel (.xlsx)'}
            </p>
            {excelFile && (
              <Badge variant="secondary" className="mt-1.5 text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                ✓ Seleccionado
              </Badge>
            )}
          </motion.div>

          {/* PDF Input */}
          <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${
              isDraggingPdf 
                ? 'border-[#007BFF] bg-[#007BFF]/5 dark:bg-[#007BFF]/10' 
                : pdfFile 
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
              className="hidden"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
            <div className="flex items-center justify-center gap-1.5 mb-1.5">
              <FileText className="h-6 w-6 text-red-500" />
              <Eye className="h-3.5 w-3.5 text-[#007BFF]" />
            </div>
            <p className="text-xs font-medium">
              {pdfFile ? pdfFile.name : 'Archivo PDF (OCR automático)'}
            </p>
            {pdfFile && (
              <Badge variant="secondary" className="mt-1.5 text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                ✓ Seleccionado
              </Badge>
            )}
          </motion.div>

          {/* Upload Button */}
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
            <Button
              onClick={handleUpload}
              disabled={isUploading || !excelFile || !pdfFile}
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
  const { productSummary, scanEvents } = useAppStore()

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

// Product Row Component
function ProductRow({ product }: { product: ProductData }) {
  const assignments = useAppStore((s) => s.assignmentsMap[product.code])
  const [isOpen, setIsOpen] = useState(false)
  const fetchAssignments = useAppStore((s) => s.fetchAssignments)

  const progressPercent = product.totalRequested > 0
    ? Math.round((product.totalScanned / product.totalRequested) * 100)
    : 0

  const handleToggle = async () => {
    const newState = !isOpen
    setIsOpen(newState)
    if (newState && !assignments) {
      await fetchAssignments(product.code)
    }
  }

  return (
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
              <p className="text-xs text-muted-foreground italic px-3">Sin asignaciones</p>
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
  )
}

// Product List Component
function ProductList() {
  const { products, productSummary, isLoading } = useAppStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('code')
  const [groupByBulto, setGroupByBulto] = useState(false)

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
  const isSuccess = scan.status === 'assigned'
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
              ? `Producto ${scan.product?.code} escaneado`
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
                → <span className="font-semibold">{scan.assignment.workerName}</span> — Itinerario {scan.assignment.itinerary}
              </p>
              <p className="text-muted-foreground">
                Progreso: {scan.assignment.scannedQuantity}/{scan.assignment.quantity}
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
  const { scanEvents } = useAppStore()

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
  const { report, fetchReport, session } = useAppStore()

  const isLoading = !report && session?.status === 'closed'

  useEffect(() => {
    if (session?.status === 'closed' && !report) {
      fetchReport()
    }
  }, [session?.status, report, fetchReport])

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

// ─── Main Page Component ─────────────────────────────────────────────

export default function ChequeoRutaChicaPage() {
  const { session, fetchSession, fetchProducts, fetchRecentScans, lastScan, initSocket, disconnectSocket, products, productSummary } = useAppStore()
  const [activeNotification, setActiveNotification] = useState<ScanResult | null>(null)
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { isListening } = useScanner()

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      await fetchSession()
      initSocket()
    }
    init()
    return () => {
      disconnectSocket()
    }
  }, [])

  // Load data when session is available
  useEffect(() => {
    if (session) {
      fetchProducts()
      fetchRecentScans()
    }
  }, [session, fetchProducts, fetchRecentScans])

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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/30">
      {/* Header */}
      <AppHeader />

      {/* Main Content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-4">
        {isSessionClosed && products.length > 0 ? (
          /* Report View when session is closed */
          <ReportView />
        ) : (
          /* Normal operational view */
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            {/* Left Sidebar */}
            <div className="space-y-4">
              <UploadPanel />
              <QuickStats />
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
    </div>
  )
}
