import { NextRequest, NextResponse } from 'next/server'

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD

export function middleware(req: NextRequest) {
  // Only protect the dashboard — not API routes
  if (req.nextUrl.pathname.startsWith('/api')) return NextResponse.next()

  // If no password is set, allow through
  if (!DASHBOARD_PASSWORD) return NextResponse.next()

  // Check cookie
  const cookie = req.cookies.get('dashboard_auth')
  if (cookie?.value === DASHBOARD_PASSWORD) return NextResponse.next()

  // Check if this is the login form submission
  if (req.method === 'POST') {
    return NextResponse.next()
  }

  // Show login page
  const url = req.nextUrl.clone()
  if (url.pathname === '/login') return NextResponse.next()

  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
