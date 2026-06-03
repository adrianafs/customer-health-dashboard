'use client'

import { HealthState } from '@/lib/types'

export const STATE_COLORS: Record<HealthState, string> = {
  stable: '#639922',
  keep_an_eye: '#EF9F27',
  action_required: '#D85A30',
  churn_risk: '#E24B4A',
}

interface ScoreBarProps {
  score: number
  healthState: HealthState
  height?: number
}

export default function ScoreBar({ score, healthState, height = 2 }: ScoreBarProps) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, backgroundColor: 'rgba(255,255,255,0.08)' }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: STATE_COLORS[healthState] }} />
    </div>
  )
}
