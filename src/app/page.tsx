'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { LoginForm } from '@/components/ui/login-form'
import { Button } from '@/components/ui/button'
import { Package, LogOut, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const ChequeoRutaChicaApp = dynamic(
  () => import('@/components/chequeo-app').then((mod) => mod.ChequeoRutaChicaApp),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center animate-pulse shadow-lg shadow-[#007BFF]/25">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-gradient-electric">Chequeo Ruta Chica</h2>
            <p className="text-sm text-muted-foreground mt-1">Droguería Nena</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-4 w-4 border-2 border-[#007BFF] border-t-transparent rounded-full animate-spin" />
            <span>Cargando aplicación...</span>
          </div>
        </div>
      </div>
    ),
  }
)

interface AuthUser {
  username: string
  name: string
}

export default function ChequeoRutaChicaPage() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // Check existing auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth')
        if (res.ok) {
          const data = await res.json()
          if (data.authenticated && data.user) {
            setUser(data.user)
          }
        }
      } catch {
        // Not authenticated
      } finally {
        setIsChecking(false)
      }
    }
    checkAuth()
  }, [])

  const handleLogin = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setUser(data.user)
        toast.success(`Bienvenido, ${data.user.name}`)
        return { success: true }
      }

      return { success: false, error: data.error || 'Error de autenticación' }
    } catch {
      return { success: false, error: 'Error de conexión al servidor' }
    }
  }, [])

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true)
    try {
      await fetch('/api/auth', { method: 'DELETE' })
      setUser(null)
      toast.success('Sesión cerrada')
    } catch {
      toast.error('Error al cerrar sesión')
    } finally {
      setIsLoggingOut(false)
    }
  }, [])

  // Loading state while checking auth
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/30">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center animate-pulse shadow-lg shadow-[#007BFF]/25">
            <Package className="h-6 w-6 text-white" />
          </div>
          <div className="h-4 w-4 border-2 border-[#007BFF] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  // Show login form if not authenticated
  if (!user) {
    return <LoginForm onLogin={handleLogin} />
  }

  // Show main app with user badge
  return (
    <div className="relative">
      {/* User badge - floating top right */}
      <div className="fixed top-2 right-2 z-[60] flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-[#007BFF]/10 shadow-sm text-xs font-medium">
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center">
            <span className="text-[9px] font-bold text-white">{user.name.charAt(0)}</span>
          </div>
          <span className="text-muted-foreground">{user.name}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="h-8 w-8 rounded-xl bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-[#007BFF]/10 shadow-sm"
        >
          {isLoggingOut ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <ChequeoRutaChicaApp />
    </div>
  )
}
