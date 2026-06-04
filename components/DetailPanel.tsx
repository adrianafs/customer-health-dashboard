'use client'
import { useState } from 'react'
import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar, { STATE_COLORS, STATE_LABELS } from './ScoreBar'

const DRIVER_ICON: Record<SignalDriver['type'], string> = { positive: '↑', neutral: '~', negative: '↓', critical: '!' }
const DRIVER_COLOR: Record<SignalDriver['type'], string> = { positive: '#00CC9A', neutral: '#F5783D', negative: '#F53D52', critical: '#F53D52' }

function SigRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11, marginTop: 4 }}>
      <span style={{ color: 'var(--fg-2)' }}>{label}</span>
      <span style={{ color: color ?? 'var(--fg-1)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

interface Props { client: Client; onClose: () => void; onRescore: (c: Client) => void }

export default function DetailPanel({ client, onClose, onRescore }: Props) {
  const [drafting, setDrafting] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [emailModal, setEmailModal] = useState<{ subject: string; body: string } | null>(null)
  const [editedSubject, setEditedSubject] = useState('')
  const [editedBody, setEditedBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSendEmail() {
    setSending(true)
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: editedSubject, body: editedBody, clientName: client.name, csmName: client.csm }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setSentTo(data.sentTo)
    } catch (e) { alert(String(e)) }
    finally { setSending(false) }
  }

  const color = STATE_COLORS[client.healthState]
  const daysToRenewal = client.contract.renewal
    ? Math.ceil((new Date(client.contract.renewal).getTime() - Date.now()) / 86400000)
    : null
  const d = client.signals.deal
  const co = client.signals.company
  const ob = client.signals.onboarding

  const stageColors: Record<string, string> = {
    active: '#00CC9A', non_renewing: '#F53D52', in_trial: '#6A00FF', paused: '#F5783D', cancelled: '#F53D52',
  }

  async function handleDraftEmail() {
    setDrafting(true)
    try {
      const res = await fetch('/api/draft-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) })
      const data = await res.json()
      setEmailModal(data)
      setEditedSubject(data.subject)
      setEditedBody(data.body)
      setSentTo(null)
    } catch { alert('Failed to draft email. Check your API key.') }
    finally { setDrafting(false) }
  }

  async function handleRescore() {
    setRescoring(true)
    try {
      const res = await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) })
      const data = await res.json()
      const stateMap: Record<string, HealthState> = { stable: 'stable', keep_an_eye: 'keep_an_eye', action_required: 'action_required', churn_risk: 'churn_risk' }
      onRescore({
        ...client,
        score: data.score ?? client.score,
        healthState: stateMap[data.healthState] ?? client.healthState,
        confidence: data.confidence ?? client.confidence,
        whyThisScore: data.reason ?? client.whyThisScore,
        recommendedAction: data.recommended_action ?? client.recommendedAction,
        scoreDrivers: (data.top_signals ?? []).map((s: { label: string; direction: string }) => ({
          label: s.label,
          type: (s.direction === 'declining' ? 'negative' : s.direction === 'improving' ? 'positive' : 'neutral') as SignalDriver['type'],
          direction: s.direction as SignalDriver['direction'],
        })),
        triggeredRules: data.triggered_rules ?? client.triggeredRules,
      })
    } catch { alert('Failed to re-score.') }
    finally { setRescoring(false) }
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(18,18,23,.3)', zIndex: 50, backdropFilter: 'blur(2px)' }} />

      {/* Panel */}
      <div className="animate-slide-in" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, background: '#fff', borderLeft: '1px solid var(--border)', zIndex: 51, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '-12px 0 32px rgba(18,18,23,.08)' }}>

        {/* Panel header */}
        <div style={{ height: 52, borderBottom: '1px solid var(--fb-neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', flexShrink: 0 }}>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--fb-violet-500)', fontWeight: 500 }}>
            ← All accounts
          </button>
          <a href={client.hubspotDealUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--fg-2)', textDecoration: 'none', padding: '5px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--fb-neutral-100)', background: 'var(--fb-neutral-50)' }}>
            ↗ HubSpot
          </a>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Client info */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--fb-neutral-100)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg-1)', lineHeight: 1.15 }}>{client.name}</div>
              {daysToRenewal !== null && daysToRenewal < 60 && (
                <div style={{ padding: '3px 10px', borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 600, background: '#FFF0F1', border: '1px solid #F53D52', color: '#F53D52', flexShrink: 0 }}>
                  Renewal in {daysToRenewal}d
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{client.csm} · €{formatARR(client.arr)}/yr</div>
          </div>

          {/* Score */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--fb-neutral-100)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, color }}>{client.score}</div>
              <div>
                <div style={{ padding: '4px 12px', borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 700, background: `${color}18`, color }}>{STATE_LABELS[client.healthState]}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 3 }}>Confidence {client.confidence}%</div>
              </div>
            </div>
            <ScoreBar score={client.score} healthState={client.healthState} height={5} />
          </div>

          {/* Why this score */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--fb-neutral-100)' }}>
            <div style={{ background: 'var(--fb-violet-50)', border: '1px solid var(--fb-violet-100)', borderRadius: 'var(--r-lg)', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fb-violet-600)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Why this score</span>
                <span style={{ padding: '2px 8px', borderRadius: 'var(--r-pill)', fontSize: 10, fontWeight: 700, background: 'var(--fb-violet-100)', color: 'var(--fb-violet-600)' }}>CONFIDENCE {client.confidence}%</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--fb-neutral-800)', lineHeight: 1.65, marginBottom: 12 }}>{client.whyThisScore}</p>
              <div style={{ background: 'rgba(106,0,255,.07)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: 'var(--fb-violet-500)', textTransform: 'uppercase', marginBottom: 4 }}>Recommended action</div>
                <div style={{ fontSize: 12, color: 'var(--fb-violet-700)', lineHeight: 1.55 }}>{client.recommendedAction}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {client.scoreDrivers.map((dr, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--fb-neutral-800)' }}>
                    <span style={{ color: DRIVER_COLOR[dr.type], fontWeight: 700, flexShrink: 0, width: 10 }}>{DRIVER_ICON[dr.type]}</span>
                    {dr.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Signals */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--fb-neutral-100)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-2)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Signals</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { title: 'Deal', source: 'HUBSPOT', rows: [
                  { k: 'Stage', v: d.stageLabel, c: d.stage === '1309169016' ? '#F53D52' : undefined },
                  { k: 'Auto renewal', v: d.autoRenewal ? 'Yes ✓' : 'No', c: d.autoRenewal ? '#00CC9A' : '#F53D52' },
                  { k: 'Renewal', v: d.closeDate ?? '—', c: daysToRenewal !== null && daysToRenewal < 60 ? '#F53D52' : undefined },
                  { k: 'Last contact', v: `${d.lastContactDaysAgo}d ago`, c: d.lastContactDaysAgo > 30 ? '#F53D52' : undefined },
                ]},
                { title: 'Company', source: 'HUBSPOT', rows: [
                  { k: 'Usage health', v: co.usageHealth ?? '—', c: co.usageHealth === 'Good' ? '#00CC9A' : co.usageHealth === 'None' ? '#F53D52' : co.usageHealth === 'Poor' ? '#F5783D' : undefined },
                  { k: 'Active flows', v: co.totalActiveFlows, c: co.totalActiveFlows <= 1 ? '#F5783D' : '#00CC9A' },
                  { k: 'Service level', v: co.serviceLevel ?? '—' },
                  { k: 'NPS status', v: co.npsStatus ?? '—' },
                ]},
                { title: 'Onboarding', source: 'HUBSPOT', rows: [
                  { k: 'Active', v: ob.active ? 'Yes' : 'No' },
                  { k: 'Days in OB', v: ob.active ? ob.daysInOnboarding : '—', c: ob.daysInOnboarding > 90 ? '#F53D52' : undefined },
                  { k: 'Stage', v: ob.stage ?? '—' },
                  { k: 'Open tasks', v: client.signals.openTasks, c: client.signals.openTasks > 0 ? '#F5783D' : undefined },
                ]},
                { title: 'Call Sentiment', source: 'FATHOM', custom: (
                  <p style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-1)', lineHeight: 1.6 }}>
                    {client.signals.fathom.summaries ?? <span style={{ color: 'var(--fg-3)' }}>No call data available</span>}
                  </p>
                )},
              ].map(sc => (
                <div key={sc.title} style={{ background: 'var(--fb-neutral-50)', border: '1px solid var(--fb-neutral-100)', borderRadius: 'var(--r-lg)', padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-1)' }}>{sc.title}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>{sc.source}</span>
                  </div>
                  {sc.custom ?? sc.rows?.map((r, i) => <SigRow key={i} label={r.k} value={r.v as string} color={r.c} />)}
                </div>
              ))}
            </div>
          </div>

          {/* Contract */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--fb-neutral-100)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-2)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Contract</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {[
                { l: 'Start', v: client.contract.start ?? '—' },
                { l: 'Renewal', v: client.contract.renewal ?? '—', danger: daysToRenewal !== null && daysToRenewal < 60 },
                { l: 'Age', v: `${client.contract.ageMonths}mo` },
              ].map(c => (
                <div key={c.l} style={{ background: 'var(--fb-neutral-50)', border: '1px solid var(--fb-neutral-100)', borderRadius: 'var(--r-lg)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{c.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.danger ? '#F53D52' : 'var(--fg-1)' }}>{c.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: '16px 18px 24px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-2)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Actions</div>
            <button onClick={handleDraftEmail} disabled={drafting} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 'var(--r-md)', background: 'var(--fb-violet-500)', color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 8, boxShadow: 'var(--shadow-violet)', opacity: drafting ? .6 : 1 }}>
              ✉ {drafting ? 'Drafting…' : 'Draft retention email'}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <a href={client.hubspotDealUrl} target="_blank" rel="noopener noreferrer"
                style={{ padding: '9px 12px', borderRadius: 'var(--r-md)', background: 'var(--fb-neutral-50)', color: 'var(--fg-1)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}>
                ↗ Open in HubSpot
              </a>
              <button onClick={handleRescore} disabled={rescoring}
                style={{ padding: '9px 12px', borderRadius: 'var(--r-md)', background: 'var(--fb-neutral-50)', color: 'var(--fg-1)', border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: rescoring ? .6 : 1 }}>
                {rescoring ? '⟳ Scoring…' : '↻ Re-score'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Email modal */}
      {emailModal && (
        <>
          <div onClick={() => { setEmailModal(null); setSentTo(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(7,15,34,.6)', zIndex: 200, backdropFilter: 'blur(4px)' }} />
          <div className="animate-fade-up" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(600px,95vw)', maxHeight: '92vh', background: '#fff', borderRadius: 'var(--r-xl)', zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 48px -12px rgba(18,18,23,.22)' }}>

            {/* Modal header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--fb-neutral-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 16 }}>✉</span>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-1)' }}>Draft retention email</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 1 }}>{client.name} · from {client.csm}</div>
                </div>
              </div>
              <button onClick={() => { setEmailModal(null); setSentTo(null) }} style={{ width: 30, height: 30, borderRadius: 'var(--r-md)', border: '1px solid var(--fb-neutral-100)', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--fg-2)' }}>×</button>
            </div>

            {sentTo ? (
              /* Success state */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 32px', gap: 16, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--fb-success-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>✓</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-1)', marginBottom: 6 }}>Draft sent to your inbox</div>
                  <div style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                    Sent to <strong>{sentTo}</strong>.<br/>
                    Review it there, then forward or copy-paste to send to {client.name}.
                  </div>
                </div>
                <div style={{ marginTop: 8, padding: '10px 16px', background: 'var(--fb-violet-50)', border: '1px solid var(--fb-violet-100)', borderRadius: 8, fontSize: 12, color: 'var(--fb-violet-600)' }}>
                  Check your inbox at {sentTo}
                </div>
                <button onClick={() => { setEmailModal(null); setSentTo(null) }}
                  style={{ marginTop: 8, padding: '10px 24px', borderRadius: 'var(--r-md)', background: 'var(--fb-violet-500)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-violet)' }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                {/* Editable fields */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>

                  {/* AI badge */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: 'var(--fb-violet-50)', border: '1px solid var(--fb-violet-100)', fontSize: 10, fontWeight: 700, color: 'var(--fb-violet-600)', letterSpacing: '.06em', marginBottom: 16 }}>
                    ✦ AI-drafted · review before sending
                  </div>

                  {/* Send destination note */}
                  <div style={{ padding: '10px 14px', borderRadius: 'var(--r-md)', background: '#F0FDF9', border: '1px solid #00CC9A40', fontSize: 12, color: '#00A378', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>→</span>
                    <span>Will be sent to <strong>your {client.csm.split(' ')[0].toLowerCase()}@getflowbox.com inbox</strong> — not to the client directly</span>
                  </div>

                  {/* Subject */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fb-neutral-700)', marginBottom: 5 }}>Subject</div>
                    <input
                      value={editedSubject}
                      onChange={e => setEditedSubject(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 13, color: 'var(--fg-1)', background: '#fff', outline: 'none' }}
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fb-neutral-700)', marginBottom: 5 }}>Body</div>
                    <textarea
                      value={editedBody}
                      onChange={e => setEditedBody(e.target.value)}
                      rows={10}
                      style={{ width: '100%', padding: '12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 13, color: 'var(--fg-1)', background: '#fff', outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                    />
                  </div>
                </div>

                {/* Footer actions */}
                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--fb-neutral-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--fb-neutral-50)', flexShrink: 0 }}>
                  <button onClick={() => navigator.clipboard.writeText(`Subject: ${editedSubject}\n\n${editedBody}`)}
                    style={{ padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: 'var(--fg-2)' }}>
                    Copy
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEmailModal(null); setSentTo(null) }}
                      style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'var(--fg-1)' }}>
                      Cancel
                    </button>
                    <button onClick={handleSendEmail} disabled={sending}
                      style={{ padding: '8px 20px', borderRadius: 'var(--r-md)', background: 'var(--fb-violet-500)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--shadow-violet)', opacity: sending ? .6 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {sending ? '⟳ Sending…' : '✉ Send to my inbox'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
