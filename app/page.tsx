'use client'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Client, HealthState, CSMName, formatARR } from '@/lib/types'
import { mockClients } from '@/lib/mockData'
import ClientCard from '@/components/ClientCard'
import DetailPanel from '@/components/DetailPanel'
import { STATE_COLORS, STATE_LABELS } from '@/components/ScoreBar'

const COLUMNS: { state: HealthState; subtitle: string }[] = [
  { state: 'stable',          subtitle: 'No action' },
  { state: 'keep_an_eye',     subtitle: 'Monitor' },
  { state: 'action_required', subtitle: 'Contact today' },
  { state: 'churn_risk',      subtitle: 'Save urgently' },
]

const STAT_ICONS: Record<HealthState, { bg: string; icon: JSX.Element }> = {
  stable: {
    bg: 'var(--s50)',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 15A7 7 0 108 1a7 7 0 000 14zM5.5 8l2 2 3-3" stroke="var(--s500)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  keep_an_eye: {
    bg: 'var(--w50)',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#EAB308" strokeWidth="1.5"/><path d="M8 5v4M8 11v.5" stroke="#EAB308" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
  action_required: {
    bg: 'var(--a50)',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 14H1.5L8 2z" stroke="var(--a500)" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 7v3M8 12v.5" stroke="var(--a500)" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
  churn_risk: {
    bg: 'var(--d50)',
    icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="var(--d500)" strokeWidth="1.5"/><path d="M10.5 5.5l-5 5M5.5 5.5l5 5" stroke="var(--d500)" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
}

// ── AI Sidebar ────────────────────────────────────────────────────────────────

type AiMsg = { role: 'user' | 'assistant'; text: string; ts: string }

function AiSidebar({ clients, open, onToggle }: { clients: Client[]; open: boolean; onToggle: () => void }) {
  const [msgs, setMsgs] = useState<AiMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  function now() { return new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) }

  function buildSystem() {
    const sum = clients.map(c => `- ${c.name} (CSM: ${c.csm}): ${STATE_LABELS[c.healthState]}, score ${c.score}/100, ${c.lastContactDaysAgo}d since last contact, €${formatARR(c.arr)}. ${c.whyThisScore}`).join('\n')
    const totalARR = clients.reduce((s, c) => s + c.arr, 0)
    const riskARR = clients.filter(c => ['action_required','churn_risk'].includes(c.healthState)).reduce((s, c) => s + c.arr, 0)
    return `You are Claude, embedded in Flowbox's internal Customer Success dashboard. You help CSMs manage B2B SaaS accounts.
Today: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
Portfolio: ${clients.length} accounts · €${formatARR(totalARR)} total ARR · €${formatARR(riskARR)} at risk.
ALL ACCOUNTS:\n${sum}
Be concise, direct and actionable. Use bullet points. Reference specific account data.`
  }

  async function send() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    const ts = now()
    setMsgs(prev => [...prev, { role: 'user', text: msg, ts }])
    setLoading(true)
    try {
      const history = msgs.map(m => ({ role: m.role, content: m.text }))
      history.push({ role: 'user', content: msg })
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, system: buildSystem() }) })
      const data = await res.json()
      setMsgs(prev => [...prev, { role: 'assistant', text: data.text || 'Could not get a response.', ts: now() }])
    } catch { setMsgs(prev => [...prev, { role: 'assistant', text: 'Unable to reach Claude. Check your ANTHROPIC_API_KEY.', ts: now() }]) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [msgs, loading])

  const CHIPS = [
    { label: 'Urgent today', q: 'Which accounts need urgent attention today?' },
    { label: 'Renewals soon', q: 'Which accounts are renewing in the next 60 days and what is the risk?' },
    { label: 'Churn risks', q: 'Give me a full churn risk summary with recommended actions' },
    { label: 'Usage patterns', q: 'What patterns do you see across the declining accounts?' },
  ]

  return (
    <aside style={{ width: open ? 360 : 52, flexShrink: 0, background: 'var(--n0)', borderLeft: '1px solid var(--n200)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'width .28s cubic-bezier(.4,0,.2,1)' }}>
      {/* Header */}
      <div style={{ height: 56, borderBottom: '1px solid var(--n100)', display: 'flex', alignItems: 'center', padding: open ? '0 14px' : 0, gap: 10, flexShrink: 0, justifyContent: open ? 'flex-start' : 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: 999, background: 'linear-gradient(135deg,var(--v500),var(--v300))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M6 .75l1.5 3.5 3.5 1.5-3.5 1.5L6 10.75 4.5 7.25 1 5.75l3.5-1.5L6 .75z" fill="white"/></svg>
        </div>
        {open && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n900)', whiteSpace: 'nowrap', overflow: 'hidden', letterSpacing: '-.01em' }}>Claude AI</div>
              <div style={{ fontSize: 10, color: 'var(--n500)', whiteSpace: 'nowrap', marginTop: 1 }}>CS intelligence</div>
            </div>
            <button onClick={onToggle} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--n200)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--n500)', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l4 4-4 4M1 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </>
        )}
        {!open && (
          <button onClick={onToggle} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--n500) ' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l-4 4 4 4M13 7H1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>

      {open && (
        <>
          {/* Body */}
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Welcome card */}
            {msgs.length === 0 && (
              <div style={{ background: 'linear-gradient(135deg,var(--v500) 0%,var(--v300) 100%)', borderRadius: 16, padding: 18, color: '#fff', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 80% 20%,rgba(255,255,255,.12),transparent 50%)', zIndex: 0 }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.01em' }}>Hi, I'm Claude</div>
                  <div style={{ fontSize: 11.5, opacity: .82, lineHeight: 1.55, marginTop: 4 }}>Watching your {clients.length} accounts. Ask me anything about churn risk, renewals, or what to prioritise today.</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
                    {CHIPS.map(c => (
                      <button key={c.label} onClick={() => { setInput(c.q); setTimeout(send, 0) }}
                        style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.22)', fontSize: 11, fontWeight: 500, color: '#fff', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            {msgs.map((m, i) => (
              <div key={i} className="animate-msg" style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.role === 'assistant' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 999, background: 'linear-gradient(135deg,var(--v500),var(--v300))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5.75l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8L.75 4.75l2.55-1.2L4.5.75z" fill="white"/></svg>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--v600)' }}>Claude</span>
                    <span style={{ fontSize: 10, color: 'var(--n400)' }}>{m.ts}</span>
                  </div>
                )}
                <div style={{ maxWidth: '100%', padding: '10px 13px', borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', fontSize: 12.5, lineHeight: 1.65, background: m.role === 'user' ? 'var(--v500)' : 'var(--n50)', color: m.role === 'user' ? '#fff' : 'var(--n900)', border: m.role === 'assistant' ? '1px solid var(--n200)' : 'none' }}
                  dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/^- (.+)$/gm, '<div style="display:flex;gap:5px;margin:2px 0"><span style="color:var(--v500);font-weight:700;flex-shrink:0">·</span><span>$1</span></div>').replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>') }} />
                {m.role === 'user' && <span style={{ fontSize: 10, color: 'var(--n400)', padding: '0 3px' }}>{m.ts}</span>}
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="animate-msg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ padding: '10px 13px', borderRadius: '12px 12px 12px 4px', background: 'var(--n50)', border: '1px solid var(--n200)', display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--n400)', animation: `pulse .75s ease-in-out ${i * .2}s infinite` }} />)}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--n100)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--n50)', border: '1px solid var(--n200)', borderRadius: 12, padding: '8px 8px 8px 12px', transition: 'border-color .15s' }}
              onFocus={() => {}} >
              <textarea value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 100) + 'px' }}
                placeholder="Ask Claude about your accounts…" rows={1}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--n900)', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto' }} />
              <button onClick={send} disabled={loading || !input.trim()}
                style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: 'var(--v500)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sv)', opacity: loading || !input.trim() ? .35 : 1 }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1.5l12 5.5L1 12.5V8.5L9 7 1 5.5V1.5z" fill="white"/></svg>
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'mock' | 'hubspot'>('mock')
  const [allClients, setAllClients] = useState<Client[]>(mockClients)
  const [csmList, setCsmList] = useState<{ name: CSMName; ownerId: string }[]>([])
  const [activeCsmId, setActiveCsmId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [aiOpen, setAiOpen] = useState(true)
  const [lastSync, setLastSync] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetch('/api/hubspot/companies')
      const data = await res.json()
      if (!res.ok) { setApiError(`${res.status}: ${data?.error ?? 'unknown'}`) }
      else if (data?.clients?.length > 0) {
        setAllClients(data.clients)
        if (data.csmOwnerIds?.length > 0) setCsmList(data.csmOwnerIds)
        setDataSource('hubspot')
        setLastSync(new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }))
        setLoading(false)
        return
      } else { setApiError('0 customers returned') }
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--font)' }}>

      {/* Header */}
      <header style={{ height: 56, background: 'var(--n0)', borderBottom: '1px solid var(--n200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, boxShadow: 'var(--ss)', zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
              <path d="M17 3.103l12.6 7.277v14.554L17 32.21 4.4 24.934V10.38L17 3.103z" fill="#F3EBFF" stroke="#6A00FF" strokeWidth="1.6"/>
              <path d="M17 10l5.5 3.175v6.35L17 22.5l-5.5-3.175V12.5L17 10z" fill="#6A00FF"/>
              <path d="M17 13.5l2.5 1.443v2.886L17 19.5l-2.5-1.443V14.5L17 13.5z" fill="white" opacity=".75"/>
            </svg>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--n900)', letterSpacing: '-.025em', lineHeight: 1 }}>Customer Health</div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--n500)', letterSpacing: '.05em', textTransform: 'uppercase', marginTop: 1 }}>Flowbox CS · Internal</div>
            </div>
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--n200)' }} />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', background: dataSource === 'hubspot' ? 'var(--s50)' : 'var(--v50)', border: `1px solid ${dataSource === 'hubspot' ? '#00CC9A' : 'var(--v200)'}`, color: dataSource === 'hubspot' ? 'var(--s600)' : 'var(--v600)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: dataSource === 'hubspot' ? '#00CC9A' : 'var(--v500)' }} className="animate-pulse-dot" />
            {dataSource === 'hubspot' ? 'HubSpot live' : 'Mock data'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastSync && <span style={{ fontSize: 11, color: 'var(--n400)' }}>Updated {lastSync}</span>}
          <button onClick={loadData} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, fontFamily: 'var(--font)', fontWeight: 500, cursor: 'pointer', fontSize: 12, padding: '6px 12px', background: 'var(--n0)', color: 'var(--n900)', border: '1px solid var(--n200)', boxShadow: 'var(--ss)', opacity: loading ? .6 : 1 }}>
            {loading ? <span className="animate-spin-cls">↻</span> : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10.5 6A4.5 4.5 0 111.5 6M10.5 2.5V6H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            {loading ? 'Syncing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Shell */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Sub-header */}
          <div style={{ background: 'var(--n0)', borderBottom: '1px solid var(--n200)', flexShrink: 0 }}>
            {/* Error */}
            {apiError && (
              <div style={{ padding: '6px 24px', background: 'var(--d50)', borderBottom: '1px solid var(--d500)', fontSize: 11, color: 'var(--d600)', display: 'flex', gap: 8 }}>
                <span>⚠ HubSpot error:</span><span style={{ fontFamily: 'var(--mono)' }}>{apiError}</span>
              </div>
            )}
            {/* Stats */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--n100)' }}>
              {COLUMNS.map((col, i) => (
                <div key={col.state} style={{ flex: 1, padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: i > 0 ? '1px solid var(--n100)' : 'none' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: STAT_ICONS[col.state].bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {STAT_ICONS[col.state].icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1, color: STATE_COLORS[col.state] }}>{counts[col.state]}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n700)' }}>{STATE_LABELS[col.state]}</div>
                    <div style={{ fontSize: 10, color: 'var(--n400)', marginTop: 1 }}>{col.subtitle}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px' }}>
              <div style={{ display: 'flex', background: 'var(--n50)', border: '1px solid var(--n200)', borderRadius: 8, padding: 3, gap: 2 }}>
                {[{ name: 'All CSMs', ownerId: 'all' }, ...csmList].map(csm => (
                  <button key={csm.ownerId} onClick={() => { setActiveCsmId(csm.ownerId); setSelectedClient(null) }}
                    style={{ padding: '5px 13px', borderRadius: 6, border: 'none', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'all .12s', background: activeCsmId === csm.ownerId ? 'var(--n0)' : 'none', color: activeCsmId === csm.ownerId ? 'var(--n900)' : 'var(--n500)', boxShadow: activeCsmId === csm.ownerId ? 'var(--ss)' : 'none' }}>
                    {csm.name}
                  </button>
                ))}
              </div>
              <div style={{ position: 'relative', flex: 1, maxWidth: 220 }}>
                <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--n400)', pointerEvents: 'none' }} width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M9.5 9.5L11.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search accounts…"
                  style={{ width: '100%', padding: '7px 12px 7px 32px', borderRadius: 8, border: '1px solid var(--n200)', background: 'var(--n0)', fontFamily: 'var(--font)', fontSize: 12, color: 'var(--n900)', outline: 'none' }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--n500)', marginLeft: 'auto' }}>{clients.length} accounts</span>
            </div>
          </div>

          {/* Board */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 32px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, alignItems: 'start' }}>
            {COLUMNS.map(col => {
              const colClients = clients.filter(c => c.healthState === col.state)
              return (
                <div key={col.state}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATE_COLORS[col.state], flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.01em' }}>{STATE_LABELS[col.state]}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--n500)', background: 'var(--n100)', borderRadius: 999, padding: '1px 7px' }}>{colClients.length}</span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--n400)', fontWeight: 500 }}>{col.subtitle}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {colClients.length === 0
                      ? <div style={{ padding: '28px 16px', borderRadius: 12, border: '1.5px dashed var(--n200)', fontSize: 12, color: 'var(--n400)', textAlign: 'center' }}>No accounts</div>
                      : colClients.map((c, i) => (
                        <div key={c.id} style={{ animationDelay: `${i * 35}ms` }}>
                          <ClientCard client={c} onClick={() => setSelectedClient(c)} selected={selectedClient?.id === c.id} />
                        </div>
                      ))
                    }
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* AI Sidebar */}
        <AiSidebar clients={clients} open={aiOpen} onToggle={() => setAiOpen(v => !v)} />
      </div>

      {selectedClient && (
        <DetailPanel client={selectedClient} onClose={() => setSelectedClient(null)} onRescore={handleRescore} />
      )}
    </div>
  )
}
