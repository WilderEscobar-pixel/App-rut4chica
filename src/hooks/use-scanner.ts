'use client'

import { useEffect, useCallback, useRef } from 'react'
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
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const scanBarcode = useAppStore((s) => s.scanBarcode)
  const session = useAppStore((s) => s.session)
  const setScannerListening = useAppStore((s) => s.setScannerListening)
  const isScanning = useAppStore((s) => s.isScanning)

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

          // Only process if session is active
          if (session && session.status === 'active') {
            event.preventDefault()
            event.stopPropagation()
            scanBarcode(barcode)
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
    [cfg, scanBarcode, session, setScannerListening]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      setScannerListening(false)
    }
  }, [handleKeyDown, setScannerListening])

  return {
    isScanning,
    isListening: useAppStore((s) => s.isScannerListening),
  }
}
