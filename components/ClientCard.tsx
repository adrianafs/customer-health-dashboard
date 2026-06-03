'use client'

import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar, { STATE_COLORS } from './ScoreBar'

const STATE_BG: Record<HealthState, string> = {
  stable: 'rgba(99,153,34,0.12)',
  keep_an_eye: 'rgba(239,159,39,0.12)',
  action_required: 'rgba(216,90,48,0.12)',
  churn_risk: 'rgba(226,75,74,0.12)',
}

function DriverIcon({ type }: { type: SignalDriver['type'] }) {
  if (type === 'positive') return <span className="text-green-400 font-bold text-xs">↑</span>
  if (type === 'negative') return <span className="text-orange-400 font-bold text-xs">↓</span>
  if (type === 'critical') return <span className="text-red-400 font-bold text-xs">!</span>
  return <span className="text-amber-400 font-bold text-xs">~</span>
}

const CSM_INITIALS: Record<string, string> = {
  Claudia: 'CN', Cecile: 'CG', Sophia: 'SJ', Jerry: 'JW',
  Chantal: 'CB', Frida: 'FL', Oktawia: 'OG', Jana: 'JK', David: 'DK',
}

interface ClientCardProps {
  client: Client
  onClick: () => void
}

export default function ClientCard({ client, onClick }: ClientCardProps) {
  const color = STATE_COLORS[client.healthState]
  const topDrivers = client.scoreDrivers.slice(0, 3)

  return (
    <button onClick={onClick} className="w-full text-left rounded-lg overflow-hidden transition-all duration-150 hover:brightness-110 active:scale-[0.99]"
      style={{ backgroundColor: '#13131a', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex">
        <div className="w-[3px] shrink-0 rounded-l-lg" style={{ backgroundColor: color }} />
        <div className="flex-1 p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-white truncate block">{client.name}</span>
              <span className="font-mono text-[11px] text-gray-500">€{formatARR(client.arr)}</span>
            </div>
            <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: STATE_BG[client.healthState], color }}>
              {client.score}
            </span>
          </div>

          <div className="mb-2">
            <ScoreBar score={client.score} healthState={client.healthState} height={2} />
          </div>

          <div className="space-y-0.5 mb-2">
            {topDrivers.map((d, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <DriverIcon type={d.type} />
                <span className="text-[11px] text-gray-400 truncate">{d.label}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#9ca3af' }}>
              {CSM_INITIALS[client.csm] ?? client.csm}
            </span>
            <span className="text-[10px] text-gray-500">
              {client.lastContactDaysAgo === 0 ? 'Today' : `${client.lastContactDaysAgo}d ago`}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}
