'use client'
import { Client, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar, { STATE_COLORS } from './ScoreBar'

const DI: Record<SignalDriver['type'], string> = { positive: '↑', neutral: '~', negative: '↓', critical: '!' }
const DC: Record<SignalDriver['type'], string> = { positive: '#00CC9A', neutral: '#EAB308', negative: '#F53D52', critical: '#F53D52' }

function csmGradient(name: string) {
  const n = name.toLowerCase()
  if (n.startsWith('a')) return 'linear-gradient(135deg,#6A00FF,#AF79FE)'
  if (n.startsWith('c')) return 'linear-gradient(135deg,#00CC9A,#00A378)'
  if (n.startsWith('s')) return 'linear-gradient(135deg,#6A00FF,#AF79FE)'
  if (n.startsWith('f')) return 'linear-gradient(135deg,#F5783D,#EAB308)'
  if (n.startsWith('j')) return 'linear-gradient(135deg,#F53D52,#F5783D)'
  if (n.startsWith('o')) return 'linear-gradient(135deg,#8A38F5,#6A00FF)'
  if (n.startsWith('d')) return 'linear-gradient(135deg,#00A378,#00CC9A)'
  return 'linear-gradient(135deg,#6A00FF,#AF79FE)'
}

export default function ClientCard({ client, onClick, selected }: { client: Client; onClick: () => void; selected?: boolean }) {
  const col = STATE_COLORS[client.healthState]

  return (
    <div
      onClick={onClick}
      className="animate-card"
      style={{
        background: 'var(--n0)',
        borderRadius: 12,
        border: selected ? `1px solid var(--v500)` : '1px solid var(--n200)',
        borderTop: `3px solid ${col}`,
        padding: 14,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: selected ? '0 0 0 2px var(--v500), var(--sm)' : 'var(--ss)',
        transition: 'all .18s',
      }}
      onMouseEnter={e => { if (!selected) { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--sm)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--n300)' } }}
      onMouseLeave={e => { if (!selected) { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--ss)'; (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.borderColor = 'var(--n200)' } }}
    >
      {/* Onboarding tag */}
      {client.signals.onboarding.active && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: 'var(--v600)', background: 'var(--v50)', border: '1px solid var(--v100)', borderRadius: 999, padding: '2px 8px', marginBottom: 7 }}>
          ◉ Onboarding
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2 }}>{client.name}</div>
          <div style={{ fontSize: 11, color: 'var(--n500)', fontFamily: 'var(--mono)', marginTop: 2, letterSpacing: '-.01em' }}>€{formatARR(client.arr)}</div>
        </div>
        <div style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800, flexShrink: 0, background: `${col}14`, color: col, letterSpacing: '-.01em' }}>
          {client.score}
        </div>
      </div>

      {/* Score bar */}
      <div style={{ marginBottom: 10 }}>
        <ScoreBar score={client.score} healthState={client.healthState} height={3} />
      </div>

      {/* Drivers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
        {client.scoreDrivers.slice(0, 3).map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11, color: 'var(--n700)', lineHeight: 1.4 }}>
            <span style={{ color: DC[d.type], fontWeight: 800, width: 10, flexShrink: 0, lineHeight: 1.4 }}>{DI[d.type]}</span>
            <span>{d.label}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--n100)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 20, height: 20, borderRadius: 999, background: csmGradient(client.csm), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
            {client.csm.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 11, color: 'var(--n500)', fontWeight: 500 }}>{client.csm}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--n400)', fontFamily: 'var(--mono)' }}>
          {client.lastContactDaysAgo === 0 ? 'Today' : `${client.lastContactDaysAgo}d ago`}
        </span>
      </div>
    </div>
  )
}
