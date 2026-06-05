'use client'
import { Client, SignalDriver, formatARR } from '@/lib/types'
import ScoreBar, { STATE_COLORS } from './ScoreBar'

export type Design = 'night' | 'day'

const DI: Record<SignalDriver['type'], string> = { positive: '↑', neutral: '~', negative: '↓', critical: '!' }
const DC: Record<SignalDriver['type'], string> = { positive: '#00CC9A', neutral: '#EAB308', negative: '#F53D52', critical: '#F53D52' }

// Circular score ring
function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 18, circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(0, Math.min(100, score)) / 100)
  return (
    <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--n100)" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          strokeLinecap="round" transform="rotate(-90 22 22)" />
      </svg>
      <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 11, fontWeight: 800, color }}>{score}</span>
    </div>
  )
}

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

const BRAND_LABEL: Record<string, string> = {
  flowbox: 'Flowbox',
  dream:   'Dream',
  both:    'Full Suite',
}

const BRAND_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  flowbox: { bg: '#F3EBFF', color: '#6A00FF', border: '#E4D1FF' },
  dream:   { bg: '#E4F7EE', color: '#00A378', border: '#B8EDDA' },
  both:    { bg: '#FFF8E6', color: '#B45309', border: '#FDE68A' },
}

function renewalBadge(renewal: string | null) {
  if (!renewal) return null
  const days = Math.ceil((new Date(renewal).getTime() - Date.now()) / 86400000)
  if (days <= 0 || days > 90) return null

  const urgent = days <= 30
  const bg     = urgent ? '#FFF0F1' : '#FFF8E6'
  const color  = urgent ? '#F53D52' : '#B45309'
  const border = urgent ? '#F53D52' : '#FDE68A'
  const label  = days <= 30 ? `Renews in ${days}d` : `Renews in ${days}d`

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700,
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: 999, padding: '2px 8px',
    }}>
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <circle cx="4.5" cy="4.5" r="4" stroke={color} strokeWidth="1"/>
        <path d="M4.5 2.5v2.25l1.25 1" stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {label}
    </div>
  )
}

export default function ClientCard({ client, onClick, selected, grayscale, design = 'night' }: { client: Client; onClick: () => void; selected?: boolean; grayscale?: boolean; design?: Design }) {
  const col   = grayscale ? 'var(--n400)' : STATE_COLORS[client.healthState]
  const brand = client.brand ?? null
  const ren   = renewalBadge(client.contract.renewal)
  const isDay = design === 'day'

  return (
    <div
      onClick={onClick}
      className="animate-card"
      style={{
        background: 'var(--n0)',
        borderRadius: 12,
        border: selected ? `1px solid var(--v500)` : '1px solid var(--n200)',
        ...(isDay ? { borderTop: `3px solid ${col}` } : {}),
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
      {/* Tags row: Winback status · Onboarding · Brand · Renewal */}
      {(client.winbackStatus || client.signals.onboarding.active || brand || ren) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7, flexWrap: 'wrap' }}>
          {client.winbackStatus === 'in_winback' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FFF8E6', border: '1px solid #FDE68A', borderRadius: 999, padding: '2px 8px' }}>
              ↩ In Winback
            </div>
          )}
          {client.winbackStatus === 'lost_case' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--n0)', background: 'var(--n500)', border: '1px solid var(--n400)', borderRadius: 999, padding: '2px 8px' }}>
              ✕ Lost Case
            </div>
          )}
          {client.signals.onboarding.active && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: 'var(--v600)', background: 'var(--v50)', border: '1px solid var(--v100)', borderRadius: 999, padding: '2px 8px' }}>
              ◉ Onboarding
            </div>
          )}
          {brand && BRAND_STYLE[brand] && (
            <div style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, background: BRAND_STYLE[brand].bg, color: BRAND_STYLE[brand].color, border: `1px solid ${BRAND_STYLE[brand].border}`, borderRadius: 999, padding: '2px 8px' }}>
              {BRAND_LABEL[brand]}
            </div>
          )}
          {ren}
        </div>
      )}

      {/* Header — day: name + score pill + bar · night: score ring + name */}
      {isDay ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2 }}>{client.name}</div>
              <div style={{ fontSize: 11, color: 'var(--n500)', fontFamily: 'var(--mono)', marginTop: 2, letterSpacing: '-.01em' }}>€{formatARR(client.arr)}</div>
            </div>
            <div style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800, flexShrink: 0, background: `${col}14`, color: col, letterSpacing: '-.01em' }}>
              {client.score}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <ScoreBar score={client.score} healthState={client.healthState} height={3} />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <ScoreRing score={client.score} color={col} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2 }}>{client.name}</div>
            <div style={{ fontSize: 11, color: 'var(--n500)', fontFamily: 'var(--mono)', marginTop: 2, letterSpacing: '-.01em' }}>€{formatARR(client.arr)}</div>
          </div>
        </div>
      )}

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
          {client.lastContactDaysAgo === 0 ? 'Today' : client.lastContactDaysAgo > 900 ? 'Never' : `${client.lastContactDaysAgo}d ago`}
        </span>
      </div>
    </div>
  )
}
