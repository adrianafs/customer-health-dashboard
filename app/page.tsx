'use client'

import { useState, useMemo } from 'react'
import { Client, HealthState } from '@/lib/types'
import { mockClients } from '@/lib/mockData'
import ClientCard from '@/components/ClientCard'
import DetailPanel from '@/components/DetailPanel'

const COLUMNS: { state: HealthState; label: string; subtitle: string; color: string }[] = [
  { state: 'stable', label: 'Stable', subtitle: 'No action needed', color: '#22c55e' },
  { state: 'moderate', label: 'Moderate', subtitle: 'Monitor closely', color: '#f59e0b' },
  { state: 'action_required', label: 'Action Required', subtitle: 'Contact today', color: '#f97316' },
  { state: 'churn_risk', label: 'Churn Risk', subtitle: 'Save urgently', color: '#ef4444' },
]

export default function Dashboard() {
  const [clients, setClients] = useState<Client[]>(mockClients)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [csmFilter, setCsmFilter] = useState<'All' | 'Adriana' | 'Claudia'>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const filtered = useMemo(() => {
    return clients.filter(c => {
      const matchesCSM = csmFilter === 'All' || c.csm === csmFilter
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesCSM && matchesSearch
    })
  }, [clients, csmFilter, searchQuery, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRescore(updated: Client) {
    setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
    setSelectedClient(updated)
  }

  const stateCounts = useMemo(() => {
    const counts: Record<HealthState, number> = { stable: 0, moderate: 0, action_required: 0, churn_risk: 0 }
    filtered.forEach(c => counts[c.healthState]++)
    return counts
  }, [filtered])

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#0d0d12' }}>
      {/* Header */}
      <header className="shrink-0 px-6 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: '#13131a' }}>
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 12px rgba(124,58,237,0.4)' }}>
            F
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">Customer Health Dashboard</h1>
            <p className="text-[10px] text-gray-500 mt-0.5">Flowbox Customer Success</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live dot */}
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full animate-pulse-live" style={{ backgroundColor: '#22c55e' }} />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Live</span>
          </div>
          {/* Refresh */}
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="text-[11px] px-2.5 py-1.5 rounded-lg transition-all hover:brightness-110"
            style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.09)', color: '#6b7280' }}
          >
            ↻ Refresh
          </button>
        </div>
      </header>

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
      <div className="shrink-0 px-6 py-2.5 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: '#13131a' }}>
        <span className="text-xs text-gray-500">CSM:</span>
        {(['All', 'Adriana', 'Claudia'] as const).map(csm => (
          <button
            key={csm}
            onClick={() => setCsmFilter(csm)}
            className="text-xs px-2.5 py-1 rounded-lg transition-all"
            style={{
              backgroundColor: csmFilter === csm ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
              border: csmFilter === csm ? '1px solid rgba(124,58,237,0.4)' : '1px solid rgba(255,255,255,0.07)',
              color: csmFilter === csm ? '#c084fc' : '#6b7280',
            }}
          >
            {csm}
          </button>
        ))}

        <div className="ml-auto relative">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search accounts…"
            className="text-xs pl-7 pr-3 py-1.5 rounded-lg outline-none bg-transparent"
            style={{
              border: '1px solid rgba(255,255,255,0.09)',
              color: '#d1d5db',
              backgroundColor: '#0d0d12',
              width: 180,
            }}
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 text-xs">⌕</span>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-hidden flex">
        {COLUMNS.map(col => {
          const colClients = filtered.filter(c => c.healthState === col.state)
          return (
            <div key={col.state} className="flex-1 flex flex-col min-w-0"
              style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}>
              {/* Column header */}
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

              {/* Card list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {colClients.length === 0 && (
                  <div className="text-center py-8 text-xs text-gray-700">No accounts</div>
                )}
                {colClients.map(client => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    onClick={() => setSelectedClient(client)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail panel */}
      {selectedClient && (
        <DetailPanel
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onRescore={handleRescore}
        />
      )}
    </div>
  )
}
