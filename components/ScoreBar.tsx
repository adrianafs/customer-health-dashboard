'use client'

import { HealthState } from '@/lib/types'

const STATE_COLORS: Record<HealthState, string> = {
  stable: '#22c55e',
  moderate: '#f59e0b',
  action_required: '#f97316',
  churn_risk: '#ef4444',
}

interface ScoreBarProps {
  score: number
  healthState: HealthState
  height?: number
}

export default function ScoreBar({ score, healthState, height = 2 }: ScoreBarProps) {
  const color = STATE_COLORS[healthState]
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, backgroundColor: 'rgba(255,255,255,0.08)' }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  )
}
