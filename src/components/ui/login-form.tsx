"use client"

import type React from "react"
import { useState, useRef, useEffect, useMemo } from "react"
import { User, Lock, LogIn, Eye, EyeOff, Package, AlertCircle } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

// Gooey SVG filter for the blobby effect
const GooeyFilter = () => (
  <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
    <defs>
      <filter id="gooey-effect-login">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
        <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" result="goo" />
        <feComposite in="SourceGraphic" in2="goo" operator="atop" />
      </filter>
    </defs>
  </svg>
)

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
}

const LoginForm = ({ onLogin }: LoginFormProps) => {
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isFocused, setIsFocused] = useState<"username" | "password" | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isClicked, setIsClicked] = useState(false)

  const isUnsupportedBrowser = useMemo(() => {
    if (typeof window === "undefined") return false
    const ua = navigator.userAgent.toLowerCase()
    const isSafari = ua.includes("safari") && !ua.includes("chrome") && !ua.includes("chromium")
    const isChromeOniOS = ua.includes("crios")
    return isSafari || isChromeOniOS
  }, [])

  useEffect(() => {
    // Auto-focus username field on mount
    setTimeout(() => usernameRef.current?.focus(), 500)
  }, [])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError("Ingrese usuario y contraseña")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await onLogin(username.trim(), password)
      if (!result.success) {
        setError(result.error || "Usuario o contraseña incorrectos")
      }
    } catch {
      setError("Error de conexión al servidor")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUsernameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (username.trim()) {
        setIsFocused("password")
        setTimeout(() => passwordRef.current?.focus(), 100)
      }
    }
  }

  const handlePasswordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
    setIsClicked(true)
    setTimeout(() => setIsClicked(false), 800)
  }

  // Floating particles for the gooey effect
  const particles = Array.from({ length: isFocused ? 18 : 0 }, (_, i) => (
    <motion.div
      key={i}
      initial={{ scale: 0 }}
      animate={{
        x: [0, (Math.random() - 0.5) * 40],
        y: [0, (Math.random() - 0.5) * 40],
        scale: [0, Math.random() * 0.8 + 0.4],
        opacity: [0, 0.8, 0],
      }}
      transition={{
        duration: Math.random() * 1.5 + 1.5,
        ease: "easeInOut",
        repeat: Number.POSITIVE_INFINITY,
        repeatType: "reverse",
      }}
      className="absolute w-3 h-3 rounded-full bg-gradient-to-r from-[#007BFF] to-[#339DFF]"
      style={{
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        filter: "blur(2px)",
      }}
    />
  ))

  // Click burst particles
  const clickParticles = isClicked
    ? Array.from({ length: 14 }, (_, i) => (
        <motion.div
          key={`click-${i}`}
          initial={{ x: mousePosition.x, y: mousePosition.y, scale: 0, opacity: 1 }}
          animate={{
            x: mousePosition.x + (Math.random() - 0.5) * 160,
            y: mousePosition.y + (Math.random() - 0.5) * 160,
            scale: Math.random() * 0.8 + 0.2,
            opacity: [1, 0],
          }}
          transition={{ duration: Math.random() * 0.8 + 0.5, ease: "easeOut" }}
          className="absolute w-3 h-3 rounded-full"
          style={{
            background: `rgba(${Math.floor(Math.random() * 100)}, ${Math.floor(Math.random() * 100 + 155)}, 255, 0.8)`,
            boxShadow: "0 0 8px rgba(0, 123, 255, 0.8)",
          }}
        />
      ))
    : null

  const isAnyFocused = isFocused !== null

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/30 p-4">
      <GooeyFilter />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25, duration: 0.6 }}
        className="w-full max-w-sm"
      >
        {/* Logo & Title */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <motion.div
            className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-gradient-to-br from-[#007BFF] to-[#339DFF] flex items-center justify-center shadow-lg shadow-[#007BFF]/25"
            animate={{ rotateY: [0, 360] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          >
            <Package className="h-8 w-8 text-white" />
          </motion.div>
          <h1 className="text-2xl font-bold">
            <span className="text-gradient-electric">Chequeo Ruta Chica</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Droguería Nena</p>
        </motion.div>

        {/* Login Form Card */}
        <motion.form
          onSubmit={handleSubmit}
          className="relative"
          onMouseMove={handleMouseMove}
        >
          <motion.div
            className={cn(
              "relative flex flex-col gap-0 rounded-2xl border overflow-hidden transition-all",
              isAnyFocused
                ? "border-transparent shadow-xl"
                : "border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-slate-800/80"
            )}
            animate={{
              boxShadow: isClicked
                ? "0 0 40px rgba(0, 123, 255, 0.5), 0 0 15px rgba(0, 123, 255, 0.7) inset"
                : isAnyFocused
                ? "0 15px 35px rgba(0, 123, 255, 0.15)"
                : "0 4px 16px rgba(0, 0, 0, 0.08)",
            }}
            onClick={handleClick}
          >
            {/* Animated gradient background when focused */}
            {isAnyFocused && (
              <motion.div
                className="absolute inset-0 -z-10"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 0.1,
                  background: [
                    "linear-gradient(90deg, #007BFF 0%, #339DFF 100%)",
                    "linear-gradient(90deg, #339DFF 0%, #66B2FF 100%)",
                    "linear-gradient(90deg, #007BFF 0%, #339DFF 100%)",
                  ],
                }}
                transition={{ duration: 8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
              />
            )}

            {/* Gooey particles container */}
            <div
              className="absolute inset-0 overflow-hidden rounded-2xl -z-5"
              style={{ filter: isUnsupportedBrowser ? "none" : "url(#gooey-effect-login)" }}
            >
              {particles}
            </div>

            {/* Click burst effect */}
            {isClicked && (
              <>
                <motion.div
                  className="absolute inset-0 -z-5 rounded-2xl bg-[#007BFF]/10"
                  initial={{ scale: 0, opacity: 0.7 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
                <motion.div
                  className="absolute inset-0 -z-5 rounded-2xl bg-white dark:bg-white/20"
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </>
            )}
            {clickParticles}

            {/* Username Field */}
            <div className="relative flex items-center px-4 py-3.5">
              <motion.div
                className="mr-3"
                animate={{
                  scale: isFocused === "username" ? [1, 1.2, 1] : 1,
                }}
                transition={{ duration: 0.3 }}
              >
                <User
                  size={20}
                  strokeWidth={isFocused === "username" ? 2.5 : 2}
                  className={cn(
                    "transition-all duration-300",
                    isFocused === "username" ? "text-[#007BFF]" : "text-gray-400 dark:text-gray-500"
                  )}
                />
              </motion.div>
              <input
                ref={usernameRef}
                type="text"
                placeholder="Usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setIsFocused("username")}
                onBlur={() => setTimeout(() => setIsFocused(null), 200)}
                onKeyDown={handleUsernameKeyDown}
                disabled={isSubmitting}
                className={cn(
                  "w-full bg-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium text-base relative z-10",
                  isFocused === "username" ? "text-gray-800 dark:text-white tracking-wide" : "text-gray-600 dark:text-gray-300"
                )}
                autoComplete="username"
              />
            </div>

            {/* Separator line between fields */}
            <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />

            {/* Password Field - slides down when username has content */}
            <AnimatePresence>
              <motion.div
                initial={false}
                animate={{
                  height: username.length > 0 ? "auto" : 0,
                  opacity: username.length > 0 ? 1 : 0,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="overflow-hidden"
              >
                <div className="relative flex items-center px-4 py-3.5">
                  <motion.div
                    className="mr-3"
                    animate={{
                      scale: isFocused === "password" ? [1, 1.2, 1] : 1,
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <Lock
                      size={20}
                      strokeWidth={isFocused === "password" ? 2.5 : 2}
                      className={cn(
                        "transition-all duration-300",
                        isFocused === "password" ? "text-[#007BFF]" : "text-gray-400 dark:text-gray-500"
                      )}
                    />
                  </motion.div>
                  <input
                    ref={passwordRef}
                    type={showPassword ? "text" : "password"}
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setIsFocused("password")}
                    onBlur={() => setTimeout(() => setIsFocused(null), 200)}
                    onKeyDown={handlePasswordKeyDown}
                    disabled={isSubmitting}
                    className={cn(
                      "w-full bg-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium text-base relative z-10",
                      isFocused === "password" ? "text-gray-800 dark:text-white tracking-wide" : "text-gray-600 dark:text-gray-300"
                    )}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="ml-2 text-gray-400 hover:text-[#007BFF] transition-colors relative z-10"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Pulsing glow at the top */}
            {isAnyFocused && (
              <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: [0, 0.1, 0.2, 0.1, 0],
                  background: "radial-gradient(circle at 50% 0%, rgba(0,123,255,0.8) 0%, transparent 70%)",
                }}
                transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, repeatType: "loop" }}
              />
            )}
          </motion.div>
        </motion.form>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50"
            >
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Login Button */}
        <AnimatePresence>
          {username.length > 0 && password.length > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              whileHover={{
                scale: 1.02,
                boxShadow: "0 10px 30px rgba(0, 123, 255, 0.3)",
              }}
              whileTap={{ scale: 0.98 }}
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="mt-4 w-full py-3 text-sm font-semibold rounded-2xl bg-gradient-to-r from-[#007BFF] to-[#339DFF] text-white shadow-lg shadow-[#007BFF]/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <motion.div
                  className="h-5 w-5 border-2 border-white border-t-transparent rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Iniciar Sesión
                </>
              )}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.p
          className="mt-6 text-center text-xs text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Sistema de control de inventario
        </motion.p>
      </motion.div>
    </div>
  )
}

export { LoginForm }
