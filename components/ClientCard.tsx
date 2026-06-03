'use client'

import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar from './ScoreBar'

const STATE_COLORS: Record<HealthState, string> = {
  stable: '#22c55e',
  moderate: '#f59e0b',
  action_required: '#f97316',
  churn_risk: '#ef4444',
}

const STATE_BG: Record<HealthState, string> = {
  stable: 'rgba(34,197,94,0.12)',
  moderate: 'rgba(245,158,11,0.12)',
  action_required: 'rgba(249,115,22,0.12)',
  churn_risk: 'rgba(239,68,68,0.12)',
}

function DriverIcon({ type }: { type: SignalDriver['type'] }) {
  if (type === 'positive') return <span className="text-green-400 font-bold text-xs">↑</span>
  if (type === 'negative') return <span className="text-red-400 font-bold text-xs">↓</span>
  if (type === 'critical') return <span className="text-red-400 font-bold text-xs">!</span>
  return <span className="text-amber-400 font-bold text-xs">~</span>
}

const CSM_INITIALS: Record<string, string> = {
  Adriana: 'AF',
  Claudia: 'CC',
}

interface ClientCardProps {
  client: Client
  onClick: () => void
}

export default function ClientCard({ client, onClick }: ClientCardProps) {
  const color = STATE_COLORS[client.healthState]
  const topDrivers = client.scoreDrivers.slice(0, 3)

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg overflow-hidden transition-all duration-150 hover:brightness-110 active:scale-[0.99]"
      style={{ backgroundColor: '#13131a', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Left colored border accent */}
      <div className="flex">
        <div className="w-[3px] shrink-0 rounded-l-lg" style={{ backgroundColor: color }} />
        <div className="flex-1 p-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-white truncate">{client.name}</span>
                {client.isOnboarding && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide"
                    style={{ backgroundColor: 'rgba(168,85,247,0.2)', color: '#c084fc' }}>
                    Onboarding
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-gray-500">
                DKK {formatARR(client.arr)}
              </span>
            </div>
            {/* Score badge */}
            <span
              className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: STATE_BG[client.healthState], color }}
            >
              {client.score}
            </span>
          </div>

          {/* Score bar */}
          <div className="mb-2">
            <ScoreBar score={client.score} healthState={client.healthState} height={2} />
          </div>

          {/* Top drivers */}
          <div className="space-y-0.5 mb-2">
            {topDrivers.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <DriverIcon type={d.type} />
                <span className="text-[11px] text-gray-400 truncate">{d.label}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {/* CSM chip */}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#9ca3af' }}
            >
              {CSM_INITIALS[client.csm] ?? client.csm}
            </span>
            {/* Last contact */}
            <span className="text-[10px] text-gray-500">
              {client.lastContactDaysAgo === 0 ? 'Today' : `${client.lastContactDaysAgo}d ago`}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}
