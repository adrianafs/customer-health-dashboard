'use client'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { Client, HealthState, CSMName, formatARR } from '@/lib/types'
import { mockClients } from '@/lib/mockData'
import ClientCard from '@/components/ClientCard'
import DetailPanel from '@/components/DetailPanel'
import { STATE_COLORS, STATE_LABELS } from '@/components/ScoreBar'

const COLUMNS: { state: HealthState; subtitle: string }[] = [
  { state: 'stable',          subtitle: 'No action needed' },
  { state: 'keep_an_eye',     subtitle: 'Monitor closely' },
  { state: 'action_required', subtitle: 'Contact today' },
  { state: 'churn_risk',      subtitle: 'Save urgently' },
]

export default function Dashboard() {
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'mock' | 'hubspot'>('mock')
  const [allClients, setAllClients] = useState<Client[]>(mockClients)
  const [csmList, setCsmList] = useState<{ name: CSMName; ownerId: string }[]>([])
  const [activeCsmId, setActiveCsmId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch('/api/hubspot/companies')
      const data = await res.json()
      if (!res.ok) {
        setApiError(`${res.status}: ${data?.error ?? 'unknown'}`)
      } else if (data?.clients?.length > 0) {
        setAllClients(data.clients)
        if (data.csmOwnerIds?.length > 0) setCsmList(data.csmOwnerIds)
        setDataSource('hubspot')
        setLoading(false)
        return
      } else {
        setApiError('HubSpot returned 0 customers')
      }
    } catch (e) { setApiError(String(e)) }
    setAllClients(mockClients)
    setDataSource('mock')
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    const t = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [loadData])

  const clients = useMemo(() => {
    let base = allClients
    if (activeCsmId !== 'all') base = base.filter(c => c.csmOwnerId === activeCsmId)
    if (searchQuery) base = base.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    return base
  }, [allClients, activeCsmId, searchQuery])

  const counts = useMemo(() => {
    const c: Record<HealthState, number> = { stable: 0, keep_an_eye: 0, action_required: 0, churn_risk: 0 }
    clients.forEach(x => c[x.healthState]++)
    return c
  }, [clients])

  function handleRescore(updated: Client) {
    setAllClients(prev => prev.map(c => c.id === updated.id ? updated : c))
    setSelectedClient(updated)
  }

  const activeCsmName = activeCsmId === 'all' ? 'All CSMs' : (csmList.find(c => c.ownerId === activeCsmId)?.name ?? activeCsmId)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--fb-neutral-50)', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', position: 'relative' }}>

      {/* Loading overlay */}
      {loading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(245,245,247,.8)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--fb-violet-200)', borderTopColor: 'var(--fb-violet-500)' }} className="animate-spin-custom" />
          <span style={{ fontSize: 13, color: 'var(--fg-2)', fontWeight: 500 }}>Loading from HubSpot…</span>
        </div>
      )}

      {/* Header */}
      <header style={{ height: 52, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'sticky', top: 0, zIndex: 40, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <path d="M13 2.309l9.526 5.5v11L13 24.309 3.474 18.809v-11L13 2.309z" fill="#F3EBFF" stroke="#6A00FF" strokeWidth="1.5"/>
            <path d="M13 8l4.5 2.598v5.196L13 18.196l-4.5-2.598V10.6L13 8z" fill="#6A00FF"/>
          </svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)', lineHeight: 1 }}>Customer Health</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 1 }}>Flowbox · {activeCsmName}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Source pill */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-pill)', fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', background: dataSource === 'hubspot' ? 'var(--fb-success-50)' : 'var(--fb-violet-50)', border: `1px solid ${dataSource === 'hubspot' ? '#00CC9A' : 'var(--fb-violet-200)'}`, color: dataSource === 'hubspot' ? 'var(--fb-success-600)' : 'var(--fb-violet-600)' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: dataSource === 'hubspot' ? '#00CC9A' : 'var(--fb-violet-500)' }} className="animate-pulse-dot" />
            {dataSource === 'hubspot' ? 'HubSpot Live' : 'Mock Data'}
          </div>
          <button onClick={() => loadData()} disabled={loading}
            style={{ borderRadius: 'var(--r-md)', fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#fff', color: 'var(--fg-1)', border: '1px solid var(--border)', padding: '7px 13px', boxShadow: 'var(--shadow-sm)', opacity: loading ? .5 : 1 }}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* Error banner */}
      {apiError && (
        <div style={{ background: '#FFF0F1', borderBottom: '1px solid #F53D52', padding: '8px 20px', fontSize: 11, color: '#F53D52', display: 'flex', gap: 8 }}>
          <span>⚠ HubSpot error (showing mock data):</span>
          <span style={{ fontFamily: 'monospace' }}>{apiError}</span>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', margin: '14px 20px 0', background: '#fff', borderRadius: 'var(--r-xl)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        {COLUMNS.map(col => (
          <div key={col.state} style={{ padding: '14px 18px', position: 'relative', borderRight: col.state !== 'churn_risk' ? '1px solid var(--fb-neutral-100)' : 'none' }}>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: STATE_COLORS[col.state] }}>{counts[col.state]}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2, fontWeight: 500 }}>{STATE_LABELS[col.state]}</div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: STATE_COLORS[col.state] }} />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', flexWrap: 'wrap' }}>
        {/* CSM segment control */}
        <div style={{ display: 'flex', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3, gap: 2 }}>
          {[{ name: 'All', ownerId: 'all' }, ...csmList].map(csm => (
            <button key={csm.ownerId} onClick={() => { setActiveCsmId(csm.ownerId); setSelectedClient(null) }}
              style={{ border: 'none', borderRadius: 6, padding: '5px 12px', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'all .12s', background: activeCsmId === csm.ownerId ? 'var(--fb-violet-500)' : 'none', color: activeCsmId === csm.ownerId ? '#fff' : 'var(--fg-2)' }}>
              {csm.name === 'All' ? 'All CSMs' : csm.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-3)', fontSize: 12 }}>⌕</span>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search accounts…"
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 12px 7px 28px', fontFamily: 'inherit', fontSize: 12, color: 'var(--fg-1)', background: '#fff', outline: 'none', width: 200 }} />
        </div>

        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{clients.length} accounts</span>
      </div>

      {/* Board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, padding: '0 20px 32px', alignItems: 'start' }}>
        {COLUMNS.map(col => {
          const colClients = clients.filter(c => c.healthState === col.state)
          return (
            <div key={col.state}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: STATE_COLORS[col.state], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-1)' }}>{STATE_LABELS[col.state]}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg-2)', background: 'var(--fb-neutral-100)', borderRadius: 'var(--r-pill)', padding: '1px 7px' }}>{colClients.length}</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--fb-neutral-400)', fontWeight: 500 }}>{col.subtitle}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colClients.length === 0
                  ? <div style={{ padding: '24px 16px', borderRadius: 'var(--r-lg)', border: '1px dashed var(--fb-neutral-200)', background: 'rgba(255,255,255,.5)', fontSize: 12, color: 'var(--fb-neutral-400)', textAlign: 'center' }}>No accounts</div>
                  : colClients.map(c => <ClientCard key={c.id} client={c} onClick={() => setSelectedClient(c)} selected={selectedClient?.id === c.id} />)
                }
              </div>
            </div>
          )
        })}
      </div>

      {selectedClient && (
        <DetailPanel client={selectedClient} onClose={() => setSelectedClient(null)} onRescore={handleRescore} />
      )}
    </div>
  )
}
