import { NextRequest, NextResponse } from 'next/server'

// ─── Simple Hash Function (no Bun.hash available in Next.js runtime) ──
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36)
}

// ─── Authorized Users ──────────────────────────────────────────────────
const USERS: Record<string, { passwordHash: string; name: string }> = {
  'INCE-WESCOBAR': {
    passwordHash: simpleHash('Dronena2026*.'),
    name: 'W. Escobar',
  },
  'Admi-JRODRIGUEZ': {
    passwordHash: simpleHash('Dronena2026*.'),
    name: 'J. Rodriguez',
  },
  'Admi-VOVIEDO': {
    passwordHash: simpleHash('Dronena2026*.'),
    name: 'V. Oviedo',
  },
  'Admi-JTORRES': {
    passwordHash: simpleHash('Dronena2026*.'),
    name: 'J. Torres',
  },
}

// Session token validity: 7 days
const SESSION_MAX_AGE = 7 * 24 * 60 * 60

// ─── POST: Login ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Usuario y contraseña son requeridos' },
        { status: 400 }
      )
    }

    const user = USERS[username]
    if (!user || user.passwordHash !== simpleHash(password)) {
      return NextResponse.json(
        { error: 'Usuario o contraseña incorrectos' },
        { status: 401 }
      )
    }

    // Create a simple session token
    const token = `${username}:${Date.now()}:${simpleHash(username + Date.now() + Math.random())}`

    const response = NextResponse.json({
      success: true,
      user: { username, name: user.name },
    })

    // Set HTTP-only cookie with the session token
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

    // Also set a readable cookie for client-side auth check
    response.cookies.set('auth-user', username, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Error during login:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

// ─── GET: Check Authentication ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  const username = request.cookies.get('auth-user')?.value

  if (!token || !username || !USERS[username]) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  return NextResponse.json({
    authenticated: true,
    user: { username, name: USERS[username].name },
  })
}

// ─── DELETE: Logout ────────────────────────────────────────────────────
export async function DELETE() {
  const response = NextResponse.json({ success: true })

  response.cookies.set('auth-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  response.cookies.set('auth-user', '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  return response
}
