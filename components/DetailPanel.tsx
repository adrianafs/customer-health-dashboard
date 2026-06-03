'use client'

import { useState } from 'react'
import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar, { STATE_COLORS } from './ScoreBar'

const STATE_LABELS: Record<HealthState, string> = {
  stable: 'Stable',
  keep_an_eye: 'Keep an Eye',
  action_required: 'Action Required',
  churn_risk: 'Churn Risk',
}

const STATE_BADGE_BG: Record<HealthState, string> = {
  stable: '#EAF3DE',
  keep_an_eye: '#FAEEDA',
  action_required: '#FAECE7',
  churn_risk: '#FCEBEB',
}

const STATE_BADGE_TEXT: Record<HealthState, string> = {
  stable: '#3B6D11',
  keep_an_eye: '#854F0B',
  action_required: '#993C1D',
  churn_risk: '#A32D2D',
}

function DriverIcon({ type }: { type: SignalDriver['type'] }) {
  if (type === 'positive') return <span className="text-green-400 font-bold">↑</span>
  if (type === 'negative') return <span className="text-orange-400 font-bold">↓</span>
  if (type === 'critical') return <span className="text-red-400 font-bold">!</span>
  return <span className="text-amber-400 font-bold">~</span>
}

function SigRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className="text-[11px] text-gray-300 font-mono">{value}</span>
    </div>
  )
}

function SignalCard({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#0d0d12', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white">{title}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#6b7280' }}>{source}</span>
      </div>
      <div className="space-y-1">{children}</div>
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
  const daysToRenewal = client.contract.renewal
    ? Math.ceil((new Date(client.contract.renewal).getTime() - Date.now()) / 86400000)
    : null

  async function handleDraftEmail() {
    setDrafting(true)
    try {
      const res = await fetch('/api/draft-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) })
      const data = await res.json()
      setEmailModal(data)
    } catch { alert('Failed to draft email. Check your API key.') }
    finally { setDrafting(false) }
  }

  async function handleRescore() {
    setRescoring(true)
    try {
      const res = await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client, csmName: client.csm }) })
      const data = await res.json()
      const stateMap: Record<string, HealthState> = { stable: 'stable', keep_an_eye: 'keep_an_eye', action_required: 'action_required', churn_risk: 'churn_risk' }
      onRescore({
        ...client,
        score: data.score ?? client.score,
        healthState: stateMap[data.healthState] ?? client.healthState,
        confidence: data.confidence ?? client.confidence,
        whyThisScore: data.reason ?? client.whyThisScore,
        recommendedAction: data.recommended_action ?? client.recommendedAction,
        scoreDrivers: (data.top_signals ?? client.scoreDrivers).map((s: { label: string; direction: string }) => ({
          label: s.label,
          type: s.direction === 'declining' ? 'negative' : s.direction === 'improving' ? 'positive' : 'neutral',
          direction: s.direction,
        })),
        triggeredRules: data.triggered_rules ?? client.triggeredRules,
      })
    } catch { alert('Failed to re-score. Check your API key.') }
    finally { setRescoring(false) }
  }

  const d = client.signals.deal
  const co = client.signals.company
  const ob = client.signals.onboarding

  return (
    <>
      <div className="fixed inset-0 z-30" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div className="fixed top-0 right-0 h-full z-40 flex flex-col overflow-hidden"
        style={{ width: 380, backgroundColor: '#13131a', borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">← All accounts</button>

            {/* Header */}
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white">{client.name}</h2>
                  <div className="text-xs text-gray-500 mt-0.5">{client.csm} · €{formatARR(client.arr)}</div>
                </div>
                {daysToRenewal !== null && daysToRenewal < 60 && (
                  <span className="shrink-0 text-[10px] px-2 py-1 rounded font-semibold uppercase"
                    style={{ backgroundColor: 'rgba(226,75,74,0.15)', color: '#E24B4A' }}>
                    Renews in {daysToRenewal}d
                  </span>
                )}
              </div>
            </div>

            {/* Score */}
            <div className="rounded-lg p-3" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-3xl font-black" style={{ color }}>{client.score}</span>
                <span className="text-[11px] px-2 py-1 rounded font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: STATE_BADGE_BG[client.healthState], color: STATE_BADGE_TEXT[client.healthState] }}>
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
                  {client.scoreDrivers.map((dr, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <DriverIcon type={dr.type} />
                      <span className="text-[11px] text-gray-400">{dr.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              {client.triggeredRules.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {client.triggeredRules.map(r => (
                    <span key={r} className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: '#6b7280' }}>
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Signals grid */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold mb-2">Signals</div>
              <div className="grid grid-cols-2 gap-2">
                <SignalCard title="📋 Deal" source="HUBSPOT">
                  <SigRow label="Stage" value={d.stageLabel} />
                  <SigRow label="Auto renewal" value={d.autoRenewal ? 'Yes' : 'No'} />
                  <SigRow label="Close date" value={d.closeDate ?? '—'} />
                  {d.churnDate && <SigRow label="Churn date" value={d.churnDate} />}
                  <SigRow label="Last contact" value={`${d.lastContactDaysAgo}d ago`} />
                </SignalCard>

                <SignalCard title="📊 Company" source="HUBSPOT">
                  <SigRow label="Usage" value={co.usageHealth ?? '—'} />
                  <SigRow label="Flows" value={co.totalActiveFlows} />
                  <SigRow label="Service level" value={co.serviceLevel ?? '—'} />
                  <SigRow label="NPS status" value={co.npsStatus ?? '—'} />
                  {co.churnRisk && <div className="text-[10px] text-red-400 font-semibold">⚠ Churn risk flagged</div>}
                </SignalCard>

                <SignalCard title="🚀 Onboarding" source="HUBSPOT">
                  <SigRow label="Active" value={ob.active ? 'Yes' : 'No'} />
                  {ob.active && <SigRow label="Days in OB" value={ob.daysInOnboarding} />}
                  {ob.stage && <SigRow label="Stage" value={ob.stage} />}
                  <SigRow label="Open tasks" value={client.signals.openTasks} />
                </SignalCard>

                <SignalCard title="💬 Fathom" source="FATHOM">
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    {client.signals.fathom.summaries ?? 'No call data available'}
                  </p>
                  {client.signals.fathom.openActionItems > 0 && (
                    <div className="text-[10px] text-amber-400 font-semibold mt-1">
                      {client.signals.fathom.openActionItems} open action item(s)
                    </div>
                  )}
                </SignalCard>
              </div>
            </div>

            {/* Contract */}
            {client.contract.renewal && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold mb-2">Contract</div>
                <div className="rounded-lg p-3 grid grid-cols-3 gap-2" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">Start</div>
                    <div className="text-[11px] text-gray-300 font-mono">{client.contract.start ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">Renewal</div>
                    <div className="text-[11px] font-mono" style={{ color: daysToRenewal !== null && daysToRenewal < 60 ? '#E24B4A' : '#d1d5db' }}>
                      {client.contract.renewal}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-0.5">Age</div>
                    <div className="text-[11px] text-gray-300 font-mono">{client.contract.ageMonths}mo</div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2 pb-4">
              <button onClick={handleDraftEmail} disabled={drafting}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ backgroundColor: 'rgba(168,85,247,0.8)', border: '1px solid rgba(168,85,247,0.4)' }}>
                {drafting ? 'Drafting…' : '✦ Draft retention email'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <a href={client.hubspotDealUrl} target="_blank" rel="noopener noreferrer"
                  className="py-2 rounded-lg text-xs font-medium text-center transition-all hover:brightness-110"
                  style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.09)', color: '#9ca3af' }}>
                  ↗ Open in HubSpot
                </a>
                <button onClick={handleRescore} disabled={rescoring}
                  className="py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50 hover:brightness-110"
                  style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.09)', color: '#9ca3af' }}>
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
              <button onClick={() => navigator.clipboard.writeText(`Subject: ${emailModal.subject}\n\n${emailModal.body}`)}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all hover:brightness-110"
                style={{ backgroundColor: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc' }}>
                Copy to clipboard
              </button>
              <button onClick={() => setEmailModal(null)} className="py-2 px-4 rounded-lg text-xs font-medium"
                style={{ backgroundColor: '#1a1a24', border: '1px solid rgba(255,255,255,0.07)', color: '#6b7280' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
