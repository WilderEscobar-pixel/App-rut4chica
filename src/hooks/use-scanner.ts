'use client'

import { useEffect, useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '@/lib/store'

interface ScannerConfig {
  minChars: number
  maxInterKeyDelay: number
  terminatorKey: string
}

const DEFAULT_CONFIG: ScannerConfig = {
  minChars: 3,
  maxInterKeyDelay: 50,
  terminatorKey: 'Enter',
}

export function useScanner(config: Partial<ScannerConfig> = {}) {
  // Stabilize config with useMemo - only recreate if config values actually change
  const cfg = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config.minChars, config.maxInterKeyDelay, config.terminatorKey])

  const scanBarcode = useAppStore((s) => s.scanBarcode)
  const setScannerListening = useAppStore((s) => s.setScannerListening)
  
  // Use refs for values that shouldn't trigger re-creation of handleKeyDown
  const sessionRef = useRef(useAppStore.getState().session)
  const scanBarcodeRef = useRef(scanBarcode)
  
  // Keep refs updated
  useEffect(() => {
    sessionRef.current = useAppStore.getState().session
  })
  scanBarcodeRef.current = scanBarcode

  // Subscribe to session changes without causing re-renders
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      sessionRef.current = state.session
    })
    return unsub
  }, [])

  const bufferRef = useRef<string[]>([])
  const lastKeyTimeRef = useRef<number>(0)
  const isActiveRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't capture when typing in input fields (unless it's Enter)
      const target = event.target as HTMLElement
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      // If it's Enter and we have a buffer, process it even from input fields
      if (event.key === cfg.terminatorKey) {
        if (bufferRef.current.length >= cfg.minChars) {
          const barcode = bufferRef.current.join('')
          bufferRef.current = []
          lastKeyTimeRef.current = 0

          // Only process if session is active (use ref to avoid dependency)
          const session = sessionRef.current
          if (session && session.status === 'active') {
            event.preventDefault()
            event.stopPropagation()
            scanBarcodeRef.current(barcode)
          }
        } else {
          bufferRef.current = []
        }
        return
      }

      // Skip modifier keys and special keys
      if (
        event.key.length > 1 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        bufferRef.current = []
        return
      }

      // Skip if user is typing in an input field
      if (isInputField) {
        bufferRef.current = []
        return
      }

      const now = Date.now()
      const timeSinceLastKey = now - lastKeyTimeRef.current

      // If the gap between keys is too large, start a new buffer
      if (
        lastKeyTimeRef.current > 0 &&
        timeSinceLastKey > cfg.maxInterKeyDelay
      ) {
        bufferRef.current = []
      }

      bufferRef.current.push(event.key)
      lastKeyTimeRef.current = now

      // Mark scanner as active when receiving rapid input
      if (!isActiveRef.current && bufferRef.current.length >= 2) {
        isActiveRef.current = true
        setScannerListening(true)
      }

      // Clear the buffer after a timeout (in case Enter is never pressed)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        bufferRef.current = []
        isActiveRef.current = false
        setScannerListening(false)
        lastKeyTimeRef.current = 0
      }, 500)

      // Prevent the character from appearing elsewhere
      event.preventDefault()
    },
    [cfg, setScannerListening] // Stable dependencies: cfg is memoized, setScannerListening is a stable Zustand action
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      // Don't call setScannerListening(false) in cleanup - it causes infinite loops
      // The timeout above handles cleanup naturally
    }
  }, [handleKeyDown])

  const isScanning = useAppStore((s) => s.isScanning)
  const isListening = useAppStore((s) => s.isScannerListening)

  return {
    isScanning,
    isListening,
  }
}
