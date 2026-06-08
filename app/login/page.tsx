'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/')
        router.refresh()
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--n50)', fontFamily: 'var(--font)',
    }}>
      <div style={{
        background: 'var(--n0)', borderRadius: 16, border: '1px solid var(--n200)',
        padding: '40px 36px', width: 360, boxShadow: 'var(--sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <path d="M17 3.103l12.6 7.277v14.554L17 32.21 4.4 24.934V10.38L17 3.103z" fill="#F3EBFF" stroke="#6A00FF" strokeWidth="1.6"/>
            <path d="M17 10l5.5 3.175v6.35L17 22.5l-5.5-3.175V12.5L17 10z" fill="#6A00FF"/>
            <path d="M17 13.5l2.5 1.443v2.886L17 19.5l-2.5-1.443V14.5L17 13.5z" fill="white" opacity=".75"/>
          </svg>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--n900)', letterSpacing: '-.02em' }}>Customer Health</div>
            <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 1 }}>Flowbox CS · Internal</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter dashboard password"
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${error ? 'var(--d500)' : 'var(--n200)'}`,
              fontFamily: 'var(--font)', fontSize: 13, color: 'var(--n900)',
              outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: 'var(--d500)', marginBottom: 12 }}>
              Wrong password. Try again.
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%', padding: '10px', borderRadius: 8,
              background: 'var(--v500)', color: '#fff', border: 'none',
              fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: loading || !password ? .5 : 1,
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
