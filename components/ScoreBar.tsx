'use client'
import { HealthState } from '@/lib/types'

export const STATE_COLORS: Record<HealthState, string> = {
  stable:          '#00CC9A',
  keep_an_eye:     '#EAB308',
  action_required: '#F5783D',
  churn_risk:      '#F53D52',
}

export const STATE_LABELS: Record<HealthState, string> = {
  stable:          'Stable',
  keep_an_eye:     'Keep an Eye',
  action_required: 'Action Required',
  churn_risk:      'Churn Risk',
}

export const STATE_BG: Record<HealthState, string> = {
  stable:          'var(--s50)',
  keep_an_eye:     'var(--w50)',
  action_required: 'var(--a50)',
  churn_risk:      'var(--d50)',
}

export default function ScoreBar({ score, healthState, height = 3 }: { score: number; healthState: HealthState; height?: number }) {
  return (
    <div style={{ height, borderRadius: 999, background: 'var(--n100)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${score}%`, borderRadius: 999, background: STATE_COLORS[healthState], transition: 'width .6s cubic-bezier(.4,0,.2,1)' }} />
    </div>
  )
}
