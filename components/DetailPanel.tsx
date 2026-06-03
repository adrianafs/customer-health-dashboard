'use client'

import { useState } from 'react'
import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar from './ScoreBar'

const STATE_COLORS: Record<HealthState, string> = {
  stable: '#22c55e',
  moderate: '#f59e0b',
  action_required: '#f97316',
  churn_risk: '#ef4444',
}

const STATE_LABELS: Record<HealthState, string> = {
  stable: 'Stable',
  moderate: 'Moderate',
  action_required: 'Action Required',
  churn_risk: 'Churn Risk',
}

function DriverIcon({ type }: { type: SignalDriver['type'] }) {
  if (type === 'positive') return <span className="text-green-400 font-bold">↑</span>
  if (type === 'negative') return <span className="text-red-400 font-bold">↓</span>
  if (type === 'critical') return <span className="text-red-400 font-bold">!</span>
  return <span className="text-amber-400 font-bold">~</span>
}

function SignalCard({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#0d0d12', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white">{title}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#6b7280' }}>
          {source}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function SigRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className="text-[11px] text-gray-300 font-mono">{value}</span>
    </div>
  )
}

interface DetailPanelProps {
  client: Client
  onClose: () => void
  onRescore: (updated: Client) => void
}

export default function DetailPanel({ client, onClose, onRescore }: DetailPanelProps) {
  const [drafting, setDrafting] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [emailModal, setEmailModal] = useState<{ subject: string; body: string } | null>(null)

  const color = STATE_COLORS[client.healthState]
  const daysToRenewal = Math.ceil(
    (new Date(client.contract.renewal).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  async function handleDraftEmail() {
    setDrafting(true)
    try {
      const res = await fetch('/api/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client }),
      })
      const data = await res.json()
      setEmailModal(data)
    } catch {
      alert('Failed to draft email. Check your API key.')
    } finally {
      setDrafting(false)
    }
  }

  async function handleRescore() {
    setRescoring(true)
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client }),
      })
      const data = await res.json()
      onRescore({
        ...client,
        score: data.score,
        healthState: data.healthState,
        confidence: data.confidence,
        whyThisScore: data.whyThisScore,
        recommendedAction: data.recommendedAction,
        scoreDrivers: data.scoreDrivers,
      })
    } catch {
      alert('Failed to re-score. Check your API key.')
    } finally {
      setRescoring(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30"
        style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col overflow-hidden"
        style={{ width: 380, backgroundColor: '#13131a', borderLeft: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Back button */}
            <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1">
              ← All accounts
            </button>

            {/* Client header */}
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white">{client.name}</h2>
                  <div className="text-xs text-gray-500 mt-0.5">{client.csm} · DKK {formatARR(client.arr)}</div>
                </div>
                {daysToRenewal <= 60 && (
                  <span className="shrink-0 text-[10px] px-2 py-1 rounded font-semibold uppercase"
                    style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                    Renews in {daysToRenewal}d
                  </span>
                )}
              </div>
            </div>

            {/* Score section */}
            <div className="rounded-lg p-3" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-3xl font-black" style={{ color }}>{client.score}</span>
                <span className="text-[11px] px-2 py-1 rounded font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: `${color}20`, color }}>
                  {STATE_LABELS[client.healthState]}
                </span>
              </div>
              <ScoreBar score={client.score} healthState={client.healthState} height={4} />
            </div>

            {/* Why this score */}
            <div className="rounded-lg p-3" style={{ backgroundColor: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-purple-300">⚡ Why this score</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-medium"
                  style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>
                  Confidence {client.confidence}%
                </span>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed mb-2">{client.whyThisScore}</p>
              <div className="rounded p-2 mb-2" style={{ backgroundColor: 'rgba(168,85,247,0.08)' }}>
                <div className="text-[9px] uppercase tracking-wider text-purple-400 font-semibold mb-1">Recommended Action</div>
                <p className="text-[11px] text-purple-200">{client.recommendedAction}</p>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-gray-600 font-semibold mb-1.5">Top Signals</div>
                <div className="space-y-1">
                  {client.scoreDrivers.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <DriverIcon type={d.type} />
                      <span className="text-[11px] text-gray-400">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Signals grid */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold mb-2">Signals</div>
              <div className="grid grid-cols-2 gap-2">
                {/* HubSpot */}
                <SignalCard title="✉ Tickets & Email" source="HUBSPOT">
                  <SigRow label="Open tickets" value={client.signals.hubspot.openTickets} />
                  <SigRow label="Emails 30d" value={client.signals.hubspot.emails30d} />
                  <SigRow label="Emails 90d" value={client.signals.hubspot.emails90d} />
                  <SigRow label="Last in" value={client.signals.hubspot.lastEmailIn} />
                  <SigRow label="Last out" value={client.signals.hubspot.lastEmailOut} />
                </SignalCard>

                {/* Usage — TODO: connect to core.main.ugc_company_level_usage WHERE ugc_company_id = client.id */}
                <SignalCard title="📊 Product Usage" source="DATABRICKS">
                  <SigRow label="Posts 30d" value={client.signals.usage.posts30d} />
                  <SigRow label="Approved" value={client.signals.usage.approved30d} />
                  <SigRow label="Distributed" value={client.signals.usage.distributed30d} />
                  <SigRow label="Rights reqs" value={client.signals.usage.rightsRequests30d} />
                  <SigRow label="Last active" value={client.signals.usage.lastActiveDay ?? '—'} />
                </SignalCard>

                {/* Chargebee — TODO: connect to core.main.chargebee_subscriptions WHERE cf_hs_deal_id = client.hubspotDealId */}
                <SignalCard title="💳 Subscription" source="CHARGEBEE">
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${
                      client.signals.chargebee.status === 'active' ? 'text-green-400 bg-green-900/30' :
                      client.signals.chargebee.status === 'non_renewing' ? 'text-red-400 bg-red-900/30' :
                      client.signals.chargebee.status === 'in_trial' ? 'text-purple-400 bg-purple-900/30' :
                      'text-amber-400 bg-amber-900/30'
                    }`}>
                      {client.signals.chargebee.status.replace('_', ' ')}
                    </span>
                  </div>
                  <SigRow label="End" value={client.signals.chargebee.contractEnd} />
                  {client.signals.chargebee.cancelScheduled && (
                    <div className="text-[10px] text-red-400 font-semibold">⚠ Cancel scheduled</div>
                  )}
                  <SigRow label="Due invoices" value={client.signals.chargebee.dueInvoices} />
                  {client.signals.chargebee.totalDues > 0 && (
                    <SigRow label="Total dues" value={`DKK ${formatARR(client.signals.chargebee.totalDues)}`} />
                  )}
                </SignalCard>

                {/* Fathom */}
                <SignalCard title="💬 Call Sentiment" source="FATHOM">
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    {client.signals.fathom.sentiment ?? 'No call sentiment available'}
                  </p>
                </SignalCard>
              </div>
            </div>

            {/* Contract card */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold mb-2">Contract</div>
              <div className="rounded-lg p-3 grid grid-cols-3 gap-2" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">Start</div>
                  <div className="text-[11px] text-gray-300 font-mono">{client.contract.start}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">Renewal</div>
                  <div className="text-[11px] font-mono" style={{ color: daysToRenewal <= 60 ? '#ef4444' : '#d1d5db' }}>
                    {client.contract.renewal}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">Age</div>
                  <div className="text-[11px] text-gray-300 font-mono">{client.contract.ageMonths}mo</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 pb-4">
              <button
                onClick={handleDraftEmail}
                disabled={drafting}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ backgroundColor: 'rgba(168,85,247,0.8)', border: '1px solid rgba(168,85,247,0.4)' }}
              >
                {drafting ? 'Drafting…' : '✦ Draft retention email'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://app.hubspot.com/contacts/search?query=${encodeURIComponent(client.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 rounded-lg text-xs font-medium text-center transition-all hover:brightness-110"
                  style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.09)', color: '#9ca3af' }}
                >
                  ↗ Open in HubSpot
                </a>
                <button
                  onClick={handleRescore}
                  disabled={rescoring}
                  className="py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50 hover:brightness-110"
                  style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.09)', color: '#9ca3af' }}
                >
                  {rescoring ? 'Scoring…' : '↻ Re-score account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Email modal */}
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div className="rounded-xl max-w-lg w-full" style={{ backgroundColor: '#13131a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">✦ AI-drafted retention email</h3>
                <button onClick={() => setEmailModal(null)} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
              </div>
              <div className="mt-2 text-[11px] text-gray-500 font-mono">Subject: {emailModal.subject}</div>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed">{emailModal.body}</p>
            </div>
            <div className="p-4 border-t flex gap-2" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`Subject: ${emailModal.subject}\n\n${emailModal.body}`)
                }}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:brightness-110"
                style={{ backgroundColor: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc' }}
              >
                Copy to clipboard
              </button>
              <button
                onClick={() => setEmailModal(null)}
                className="py-2 px-4 rounded-lg text-xs font-medium"
                style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
