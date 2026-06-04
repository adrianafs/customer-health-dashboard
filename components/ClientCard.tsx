'use client'
import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar, { STATE_COLORS } from './ScoreBar'

const DRIVER_ICON: Record<SignalDriver['type'], string> = { positive: '↑', neutral: '~', negative: '↓', critical: '!' }
const DRIVER_COLOR: Record<SignalDriver['type'], string> = {
  positive: '#00CC9A', neutral: '#F5783D', negative: '#F53D52', critical: '#F53D52',
}

interface Props { client: Client; onClick: () => void; selected?: boolean }

export default function ClientCard({ client, onClick, selected }: Props) {
  const color = STATE_COLORS[client.healthState]

  return (
    <button
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: 'var(--r-lg)',
        border: selected ? '1.5px solid var(--fb-violet-500)' : '1px solid var(--border)',
        padding: '14px 14px 12px',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        textAlign: 'left',
        width: '100%',
        boxShadow: selected ? '0 0 0 3px rgba(106,0,255,.1)' : 'var(--shadow-sm)',
        transition: 'all .15s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)' }}
    >
      {/* Top color bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, borderRadius: '12px 12px 0 0' }} />

      {/* Onboarding tag */}
      {client.signals.onboarding.active && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: 'var(--fb-violet-600)', background: 'var(--fb-violet-50)', borderRadius: 'var(--r-pill)', padding: '1px 7px', marginBottom: 6, border: '1px solid var(--fb-violet-100)' }}>
          ◉ Onboarding
        </div>
      )}

      {/* Row 1: name + score */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)', lineHeight: 1.2 }}>{client.name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)', fontFamily: 'monospace', marginTop: 2 }}>€{formatARR(client.arr)}</div>
        </div>
        <div style={{ padding: '3px 9px', borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 700, flexShrink: 0, background: `${color}18`, color }}>
          {client.score}
        </div>
      </div>

      {/* Score bar */}
      <div style={{ marginBottom: 10 }}>
        <ScoreBar score={client.score} healthState={client.healthState} height={3} />
      </div>

      {/* Drivers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {client.scoreDrivers.slice(0, 3).map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--fg-2)' }}>
            <span style={{ color: DRIVER_COLOR[d.type], fontWeight: 700, flexShrink: 0, width: 10, lineHeight: 1.4 }}>{DRIVER_ICON[d.type]}</span>
            <span>{d.label}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid var(--fb-neutral-100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg, var(--fb-violet-500), var(--fb-violet-300))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {client.csm.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-2)', fontWeight: 500 }}>{client.csm}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--fg-3)', fontWeight: 500 }}>
          {client.lastContactDaysAgo === 0 ? 'Today' : `${client.lastContactDaysAgo}d ago`}
        </span>
      </div>
    </button>
  )
}
