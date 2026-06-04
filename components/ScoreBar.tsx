'use client'
import { HealthState } from '@/lib/types'

export const STATE_COLORS: Record<HealthState, string> = {
  stable:          '#00CC9A',
  keep_an_eye:     '#F5783D',
  action_required: '#F5783D',
  churn_risk:      '#F53D52',
}

export const STATE_LABELS: Record<HealthState, string> = {
  stable:          'Stable',
  keep_an_eye:     'Keep an Eye',
  action_required: 'Action Required',
  churn_risk:      'Churn Risk',
}

interface ScoreBarProps {
  score: number
  healthState: HealthState
  height?: number
}

export default function ScoreBar({ score, healthState, height = 3 }: ScoreBarProps) {
  return (
    <div style={{ height, background: 'var(--fb-neutral-100)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${score}%`, background: STATE_COLORS[healthState], borderRadius: 4, transition: 'width .6s ease' }} />
    </div>
  )
}
