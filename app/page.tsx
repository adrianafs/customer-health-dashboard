'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Client, HealthState, CSM_LIST, CSMName } from '@/lib/types'
import { mockClients } from '@/lib/mockData'
import ClientCard from '@/components/ClientCard'
import DetailPanel from '@/components/DetailPanel'

const COLUMNS: { state: HealthState; label: string; subtitle: string; color: string }[] = [
  { state: 'stable',          label: 'Stable',          subtitle: 'No action needed',  color: '#639922' },
  { state: 'keep_an_eye',     label: 'Keep an Eye',     subtitle: 'Monitor closely',   color: '#EF9F27' },
  { state: 'action_required', label: 'Action Required', subtitle: 'Contact today',     color: '#D85A30' },
  { state: 'churn_risk',      label: 'Churn Risk',      subtitle: 'Save urgently',     color: '#E24B4A' },
]

const DEFAULT_CSM = CSM_LIST[0] // Claudia

export default function Dashboard() {
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'mock' | 'hubspot'>('mock')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [activeCsmId, setActiveCsmId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [allClients, setAllClients] = useState<Client[]>(mockClients)

  const loadData = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch('/api/hubspot/companies')
      const data = await res.json()
      if (!res.ok) {
        setApiError(`API ${res.status}: ${data?.error ?? 'unknown error'}`)
      } else if (Array.isArray(data) && data.length > 0) {
        setAllClients(data)
        setDataSource('hubspot')
        setLoading(false)
        return
      } else {
        setApiError('HubSpot returned 0 customers')
      }
    } catch (e) {
      setApiError(`Network error: ${String(e)}`)
    }
    setAllClients(mockClients)
    setDataSource('mock')
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData])

  function handleCsmChange(ownerId: string) {
    setActiveCsmId(ownerId)
    setSelectedClient(null)
  }

  function handleRescore(updated: Client) {
    setAllClients(prev => prev.map(c => c.id === updated.id ? updated : c))
    setSelectedClient(updated)
  }

  // Filter by CSM (frontend — uses deal's csmOwnerId) and search query
  const clients = useMemo(() => {
    let base = allClients
    if (activeCsmId !== 'all') base = base.filter(c => c.csmOwnerId === activeCsmId)
    if (searchQuery) base = base.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    return base
  }, [allClients, activeCsmId, searchQuery])

  const filtered = clients

  const stateCounts = useMemo(() => {
    const counts: Record<HealthState, number> = { stable: 0, keep_an_eye: 0, action_required: 0, churn_risk: 0 }
    filtered.forEach(c => counts[c.healthState]++)
    return counts
  }, [filtered])

  const activeCsm = CSM_LIST.find(c => c.ownerId === activeCsmId) ?? DEFAULT_CSM

  return (
    <div className="min-h-screen flex flex-col relative" style={{ backgroundColor: '#0d0d12' }}>
      {/* Header */}
      <header className="shrink-0 px-6 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: '#13131a' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 12px rgba(124,58,237,0.4)' }}>F</div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">Customer Health Dashboard</h1>
            <p className="text-[10px] text-gray-500 mt-0.5">Flowbox Customer Success · {activeCsmId === 'all' ? 'All CSMs' : activeCsm.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full animate-pulse-live"
              style={{ backgroundColor: dataSource === 'hubspot' ? '#22c55e' : '#f59e0b' }} />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">
              {dataSource === 'hubspot' ? 'HubSpot Live' : 'Mock Data'}
            </span>
          </div>
          <button onClick={() => loadData()} disabled={loading}
            className="text-[11px] px-2.5 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.09)', color: '#6b7280' }}>
            {loading ? '⟳ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      {/* Error banner */}
      {apiError && (
        <div className="shrink-0 px-6 py-2 text-[11px] flex items-center gap-2"
          style={{ backgroundColor: 'rgba(226,75,74,0.1)', borderBottom: '1px solid rgba(226,75,74,0.2)', color: '#fca5a5' }}>
          <span>⚠ HubSpot error (showing mock data):</span>
          <span className="font-mono truncate">{apiError}</span>
        </div>
      )}

      {/* Stats bar */}
      <div className="shrink-0 flex" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {COLUMNS.map(col => (
          <div key={col.state} className="flex-1 px-6 py-2 flex items-center gap-3"
            style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
            <div>
              <span className="font-bold text-base" style={{ color: col.color }}>{stateCounts[col.state]}</span>
              <span className="text-gray-500 text-xs ml-1.5">{col.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="shrink-0 px-6 py-2.5 flex items-center gap-2 flex-wrap"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: '#13131a' }}>
        <span className="text-xs text-gray-500">CSM:</span>
        {/* All tab */}
        <button onClick={() => handleCsmChange('all')}
          className="text-xs px-2.5 py-1 rounded-lg transition-all"
          style={{
            backgroundColor: activeCsmId === 'all' ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
            border: activeCsmId === 'all' ? '1px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.07)',
            color: activeCsmId === 'all' ? '#c084fc' : '#6b7280',
          }}>
          All
        </button>
        {CSM_LIST.map(csm => (
          <button key={csm.ownerId} onClick={() => handleCsmChange(csm.ownerId)}
            className="text-xs px-2.5 py-1 rounded-lg transition-all"
            style={{
              backgroundColor: activeCsmId === csm.ownerId ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
              border: activeCsmId === csm.ownerId ? '1px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.07)',
              color: activeCsmId === csm.ownerId ? '#c084fc' : '#6b7280',
            }}>
            {csm.name}
          </button>
        ))}
        <div className="ml-auto relative">
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search accounts…"
            className="text-xs pl-7 pr-3 py-1.5 rounded-lg outline-none bg-transparent"
            style={{ border: '1px solid rgba(255,255,255,0.09)', color: '#d1d5db', backgroundColor: '#0d0d12', width: 180 }} />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 text-xs">⌕</span>
        </div>
      </div>

      {/* Loading spinner overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ backgroundColor: 'rgba(13,13,18,0.7)', top: 0 }}>
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            <span className="text-sm text-gray-400">Loading from HubSpot…</span>
          </div>
        </div>
      )}

      {/* Kanban board */}
      <div className="flex-1 overflow-hidden flex">
        {COLUMNS.map(col => {
          const colClients = filtered.filter(c => c.healthState === col.state)
          return (
            <div key={col.state} className="flex-1 flex flex-col min-w-0"
              style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="px-3 py-2.5 shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', backgroundColor: '#13131a' }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                  <span className="text-xs font-semibold text-white">{col.label}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-auto"
                    style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#6b7280' }}>
                    {colClients.length}
                  </span>
                </div>
                <div className="text-[10px] text-gray-600 mt-0.5 pl-4">{col.subtitle}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {colClients.length === 0 && <div className="text-center py-8 text-xs text-gray-700">No accounts</div>}
                {colClients.map(client => (
                  <ClientCard key={client.id} client={client} onClick={() => setSelectedClient(client)} />
                ))}
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
