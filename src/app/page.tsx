'use client'

import dynamic from 'next/dynamic'

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

export default function ChequeoRutaChicaPage() {
  return <ChequeoRutaChicaApp />
}
