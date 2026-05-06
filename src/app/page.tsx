'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, Upload, ScanLine, CheckCircle2, AlertTriangle,
  XCircle, Search, Filter, BarChart3, FileDown, Wifi, WifiOff,
  ChevronDown, ChevronUp, RefreshCw, Lock, Sun, Moon,
  PackageCheck, PackageX, PackageOpen, ClipboardList,
  FileSpreadsheet, FileText, Loader2, Scan, CircleDot
} from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'

import { useAppStore, type ProductData, type AssignmentData, type ScanResult, type ReportData } from '@/lib/store'
import { useScanner } from '@/hooks/use-scanner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

// ─── Helpers ─────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'complete': return 'bg-emerald-500'
    case 'partial': return 'bg-amber-400'
    case 'pending': return 'bg-gray-300 dark:bg-gray-600'
    case 'missing': return 'bg-red-500'
    default: return 'bg-gray-300'
  }
}

function getStatusBorderColor(status: string): string {
  switch (status) {
    case 'complete': return 'border-l-emerald-500'
    case 'partial': return 'border-l-amber-400'
    case 'pending': return 'border-l-gray-300 dark:border-l-gray-600'
    case 'missing': return 'border-l-red-500'
    default: return 'border-l-gray-300'
  }
}

function getStatusBgColor(status: string): string {
  switch (status) {
    case 'complete': return 'bg-emerald-50 dark:bg-emerald-950/30'
    case 'partial': return 'bg-amber-50 dark:bg-amber-950/30'
    case 'pending': return 'bg-white dark:bg-gray-900'
    case 'missing': return 'bg-red-50 dark:bg-red-950/30'
    default: return 'bg-white dark:bg-gray-900'
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
    case 'complete': return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    case 'partial': return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'pending': return <CircleDot className="h-4 w-4 text-gray-400" />
    case 'missing': return <XCircle className="h-4 w-4 text-red-500" />
    default: return <CircleDot className="h-4 w-4 text-gray-400" />
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
  const isFinalizing = useAppStore((s) => s.isFinalizing)
  const finalizeSession = useAppStore((s) => s.finalizeSession)

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

  return (
    <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-border">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">
                Chequeo Ruta Chica
              </h1>
              <p className="text-xs text-muted-foreground">Droguería Nena</p>
            </div>
          </div>

          {/* Center: Session info & Progress */}
          <div className="flex items-center gap-4 flex-1 justify-center">
            {session && (
              <div className="flex items-center gap-3">
                <Badge variant={session.status === 'active' ? 'default' : 'destructive'} className="text-xs">
                  {session.status === 'active' ? 'Activa' : 'Cerrada'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatDate(session.date)}
                </span>
                {productSummary && productSummary.total > 0 && (
                  <>
                    <Separator orientation="vertical" className="h-5" />
                    <div className="flex items-center gap-2 min-w-[200px]">
                      <Progress value={totalProgress} className="h-2 flex-1" />
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
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
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
                    <div className={`h-2 w-2 rounded-full ${isScannerListening ? 'bg-emerald-500 animate-pulse' : isSocketConnected ? 'bg-amber-400' : 'bg-red-500'}`} />
                    <ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {isScannerListening ? 'Escáner activo - Escuchando' : isSocketConnected ? 'Escáner conectado - En espera' : 'Escáner desconectado'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Socket Status */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`h-2 w-2 rounded-full ${isSocketConnected ? 'bg-emerald-500' : 'bg-red-400'}`} />
                </TooltipTrigger>
                <TooltipContent>
                  {isSocketConnected ? 'WebSocket conectado' : 'WebSocket desconectado'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Separator orientation="vertical" className="h-6" />

            {/* Refresh */}
            <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Theme Toggle */}
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="h-8 w-8">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Finalize */}
            {session?.status === 'active' && products.length > 0 && (
              <AlertDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="gap-1.5">
                    <Lock className="h-3.5 w-3.5" />
                    Escaneo Finalizado
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Finalizar sesión de escaneo?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acción cerrará la sesión y marcará todos los productos pendientes o parciales como &quot;Faltante&quot;. Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleFinalize}
                      disabled={isFinalizing}
                      className="bg-red-600 hover:bg-red-700"
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
  const { uploadFiles, isUploading, session } = useAppStore()
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<{
    productsCreated: number
    workersCreated: number
    workersUpdated: number
    assignmentsCreated: number
    errors: string[]
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
      toast.success('Archivos cargados exitosamente')
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Upload className="h-4 w-4 text-orange-500" />
          Cargar Datos del Día
        </CardTitle>
        <CardDescription className="text-xs">
          Suba el archivo Excel con los productos y el PDF con las asignaciones
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Excel Input */}
        <div
          className={`relative border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer ${
            isDraggingExcel ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : 'border-muted-foreground/20 hover:border-orange-300'
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
          <FileSpreadsheet className="h-5 w-5 mx-auto mb-1 text-emerald-600" />
          <p className="text-xs font-medium">
            {excelFile ? excelFile.name : 'Archivo Excel (.xlsx)'}
          </p>
          {excelFile && (
            <Badge variant="secondary" className="mt-1 text-[10px]">
              Seleccionado
            </Badge>
          )}
        </div>

        {/* PDF Input */}
        <div
          className={`relative border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer ${
            isDraggingPdf ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : 'border-muted-foreground/20 hover:border-orange-300'
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
          <FileText className="h-5 w-5 mx-auto mb-1 text-red-500" />
          <p className="text-xs font-medium">
            {pdfFile ? pdfFile.name : 'Archivo PDF (.pdf)'}
          </p>
          {pdfFile && (
            <Badge variant="secondary" className="mt-1 text-[10px]">
              Seleccionado
            </Badge>
          )}
        </div>

        {/* Upload Button */}
        <Button
          onClick={handleUpload}
          disabled={isUploading || !excelFile || !pdfFile}
          className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Cargando...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Cargar Datos
            </>
          )}
        </Button>

        {/* Upload Results */}
        <AnimatePresence>
          {uploadResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-1"
            >
              <Separator />
              <div className="text-xs space-y-1 pt-1">
                <p className="text-emerald-600 font-medium">
                  ✓ {uploadResult.productsCreated} productos creados
                </p>
                <p className="text-blue-600 font-medium">
                  ✓ {uploadResult.workersCreated} trabajadores creados, {uploadResult.workersUpdated} actualizados
                </p>
                <p className="text-amber-600 font-medium">
                  ✓ {uploadResult.assignmentsCreated} asignaciones creadas
                </p>
                {uploadResult.errors.length > 0 && (
                  <div className="text-red-500">
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
  )
}

// Quick Stats Component
function QuickStats() {
  const { productSummary, session, scanEvents } = useAppStore()

  if (!productSummary || productSummary.total === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-orange-500" />
            Resumen Rápido
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4">
            Cargue los archivos para ver estadísticas
          </p>
        </CardContent>
      </Card>
    )
  }

  const stats = [
    { label: 'Pendientes', value: productSummary.pending, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-800', icon: CircleDot },
    { label: 'Parciales', value: productSummary.partial, color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-950/30', icon: AlertTriangle },
    { label: 'Completos', value: productSummary.complete, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-950/30', icon: CheckCircle2 },
    { label: 'Faltantes', value: productSummary.missing, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-950/30', icon: XCircle },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-orange-500" />
          Resumen Rápido
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {stats.map((stat) => (
            <div key={stat.label} className={`flex items-center gap-2 p-2 rounded-lg ${stat.bg}`}>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
              <div>
                <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            </div>
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
          className="h-2"
        />
        {scanEvents.length > 0 && (
          <div className="flex justify-between text-xs pt-1">
            <span className="text-muted-foreground">Últimos escaneos</span>
            <span className="font-semibold">{scanEvents.length}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Product Row Component
function ProductRow({ product, onExpand }: { product: ProductData; onExpand: (code: string) => void }) {
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
    if (newState) onExpand(product.code)
  }

  return (
    <Collapsible open={isOpen} onOpenChange={handleToggle}>
      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border-l-4 ${getStatusBorderColor(product.status)} ${getStatusBgColor(product.status)} transition-colors hover:shadow-sm`}>
        {/* Status Icon */}
        <div className="flex-shrink-0">
          {getStatusIcon(product.status)}
        </div>

        {/* Product Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold text-foreground">{product.code}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              B{product.bulto}
            </Badge>
            {product.origen && product.origen !== 'R' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
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
          <Button variant="ghost" size="icon" className="h-6 w-6">
            {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="ml-6 mr-2 mt-1 mb-2 space-y-1">
          {assignments ? (
            assignments.length > 0 ? (
              assignments.map((a: AssignmentData) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-xs px-3 py-1.5 rounded-md bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.worker.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
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
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
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
  const fetchProducts = useAppStore((s) => s.fetchProducts)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('code')
  const [groupByBulto, setGroupByBulto] = useState(false)

  const filteredProducts = useMemo(() => {
    let result = [...products]

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter)
    }

    // Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result.filter(
        (p) =>
          p.code.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term)
      )
    }

    // Sort
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

  if (isLoading && products.length === 0) {
    return (
      <Card className="flex-1">
        <CardContent className="p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex-1 flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-orange-500" />
            Lista de Productos
            {productSummary && (
              <Badge variant="outline" className="text-xs font-normal">
                {productSummary.total} productos
              </Badge>
            )}
          </CardTitle>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por código o descripción..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
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
            <SelectTrigger className="w-[120px] h-8 text-xs">
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
            <Package className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {products.length === 0
                ? 'No hay productos. Cargue los archivos del día.'
                : 'No se encontraron productos con los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[calc(100vh-420px)] min-h-[300px]">
            <div className="space-y-1">
              {groupByBulto && groupedProducts ? (
                Object.entries(groupedProducts)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([bulto, prods]) => (
                    <div key={bulto} className="mb-3">
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <Badge variant="secondary" className="text-xs font-semibold">
                          Bulto {bulto}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {prods.length} producto{prods.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {prods.map((p) => (
                          <ProductRow key={p.id} product={p} onExpand={() => {}} />
                        ))}
                      </div>
                    </div>
                  ))
              ) : (
                filteredProducts.map((p) => (
                  <ProductRow key={p.id} product={p} onExpand={() => {}} />
                ))
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

// Scan Notification Popup
function ScanNotification({ scan, onDismiss }: { scan: ScanResult; onDismiss: () => void }) {
  const isSuccess = scan.status === 'assigned'
  const isAlreadyComplete = scan.status === 'already_complete'
  const isNotFound = scan.status === 'not_found'

  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <motion.div
      initial={{ opacity: 0, x: 100, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      className={`pointer-events-auto rounded-lg shadow-lg border p-3 max-w-sm ${
        isSuccess
          ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800'
          : isAlreadyComplete
            ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800'
            : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          {isSuccess ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : isAlreadyComplete ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
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
            <div className="mt-1 text-xs">
              <p className="text-emerald-700 dark:text-emerald-400">
                Asignado a <span className="font-semibold">{scan.assignment.workerName}</span> — Itinerario {scan.assignment.itinerary}
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
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Scan className="h-4 w-4 text-orange-500" />
          Últimos Escaneos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {scanEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No hay escaneos registrados
          </p>
        ) : (
          <ScrollArea className="max-h-48">
            <div className="space-y-1.5">
              {scanEvents.slice(0, 10).map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-muted/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ScanLine className="h-3 w-3 text-muted-foreground flex-shrink-0" />
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
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

// Report View
function ReportView() {
  const { report, fetchReport, session, isFinalizing } = useAppStore()

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
      <Card className="flex-1">
        <CardContent className="p-6">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
            <p className="text-sm text-muted-foreground">Generando reporte...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!report) return null

  const { summary, missingItems } = report

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-red-500" />
          Reporte de Faltantes — {formatDate(summary.sessionDate)}
        </CardTitle>
        <CardDescription>
          Resumen de la sesión de escaneo
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.totalProducts}</p>
            <p className="text-xs text-muted-foreground">Total Productos</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
            <p className="text-2xl font-bold text-emerald-600">{summary.completeProducts}</p>
            <p className="text-xs text-muted-foreground">Completos</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950/30">
            <p className="text-2xl font-bold text-red-600">{summary.missingProducts + summary.partialProducts + summary.pendingProducts}</p>
            <p className="text-xs text-muted-foreground">Faltantes</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <p className="text-2xl font-bold text-amber-600">{summary.completionPercentage}%</p>
            <p className="text-xs text-muted-foreground">Cumplimiento</p>
          </div>
        </div>

        <Separator />

        {/* Missing Items */}
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <PackageX className="h-4 w-4 text-red-500" />
            Productos Faltantes ({missingItems.length})
          </h3>
          <ScrollArea className="max-h-[calc(100vh-550px)] min-h-[200px]">
            <div className="space-y-2">
              {missingItems.map((item) => (
                <div
                  key={item.code}
                  className={`border-l-4 ${getStatusBorderColor(item.status)} ${getStatusBgColor(item.status)} p-3 rounded-r-lg`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-semibold text-sm">{item.code}</span>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="destructive" className="text-xs">
                        Faltan {item.missing}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {item.totalScanned}/{item.totalRequested}
                      </p>
                    </div>
                  </div>
                  {item.assignments.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {item.assignments.map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{a.workerName} (It. {a.itinerary})</span>
                          <span>{a.scannedQuantity}/{a.quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Export Button */}
        <Button onClick={handleExportCSV} className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white">
          <FileDown className="h-4 w-4 mr-2" />
          Exportar Reporte CSV
        </Button>
      </CardContent>
    </Card>
  )
}

// Footer Component
function AppFooter() {
  const { session, productSummary, isScanning } = useAppStore()

  return (
    <footer className="sticky bottom-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-t border-border mt-auto">
      <div className="max-w-screen-2xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {session && (
              <>
                <span>Sesión: {formatDate(session.date)}</span>
                <Badge variant={session.status === 'active' ? 'default' : 'destructive'} className="text-[10px] px-1.5">
                  {session.status === 'active' ? 'Activa' : 'Cerrada'}
                </Badge>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {productSummary && (
              <span>
                {productSummary.totalScanned}/{productSummary.totalRequested} unidades escaneadas
              </span>
            )}
            {isScanning && (
              <span className="flex items-center gap-1 text-orange-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                Procesando escaneo...
              </span>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────

export default function HomePage() {
  const {
    session, fetchSession, fetchProducts, fetchRecentScans,
    initSocket, disconnectSocket, lastScan, products,
  } = useAppStore()

  const { isScanning, isListening } = useScanner()
  const [scanNotifications, setScanNotifications] = useState<ScanResult[]>([])
  const [activeTab, setActiveTab] = useState('products')

  // Initialize session and socket
  useEffect(() => {
    const init = async () => {
      await fetchSession()
      initSocket()
    }
    init()
    return () => {
      disconnectSocket()
    }
  }, [fetchSession, initSocket, disconnectSocket])

  // Fetch products and recent scans when session changes
  useEffect(() => {
    if (session) {
      fetchProducts()
      fetchRecentScans()
    }
  }, [session, fetchProducts, fetchRecentScans])

  // Handle scan notifications
  useEffect(() => {
    if (lastScan) {
      setScanNotifications((prev) => [lastScan, ...prev].slice(0, 3))
    }
  }, [lastScan])

  const dismissNotification = useCallback((index: number) => {
    setScanNotifications((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const showReport = session?.status === 'closed'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />

      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 py-4">
        {/* Scan Notification Overlay */}
        <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {scanNotifications.map((scan, index) => (
              <ScanNotification
                key={`notification-${index}-${Date.now()}`}
                scan={scan}
                onDismiss={() => dismissNotification(index)}
              />
            ))}
          </AnimatePresence>
        </div>

        {showReport ? (
          <ReportView />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Sidebar */}
            <div className="lg:col-span-3 space-y-4">
              <UploadPanel />
              <QuickStats />
              <RecentScansPanel />
            </div>

            {/* Main Content */}
            <div className="lg:col-span-9">
              <ProductList />
            </div>
          </div>
        )}
      </main>

      <AppFooter />
    </div>
  )
}
