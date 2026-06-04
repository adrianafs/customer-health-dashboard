export type HealthState = 'stable' | 'keep_an_eye' | 'action_required' | 'churn_risk'

export type SignalDriver = {
  label: string
  type: 'positive' | 'neutral' | 'negative' | 'critical'
  direction?: 'improving' | 'stable' | 'declining'
}

export type CSMName = string

export const DEAL_STAGE_LABELS: Record<string, string> = {
  '1309169012': 'Contract not started',
  '1309169013': 'Active Contract',
  '1309169014': 'Up for Renewal',
  '1309169015': 'Renewal in Progress',
  '1309169016': 'Communicated Churn (in Winback)',
  '1309169017': 'Paused',
  '1309169018': 'Churned',
  '1309169019': 'Closed Won (Renewed)',
}

export type Client = {
  id: string          // deal ID
  companyId: string
  name: string
  arr: number
  currency: string
  csm: CSMName
  csmOwnerId: string
  healthState: HealthState
  score: number
  confidence: number
  whyThisScore: string
  recommendedAction: string
  scoreDrivers: SignalDriver[]
  triggeredRules: string[]
  signals: {
    deal: {
      stage: string
      stageLabel: string
      autoRenewal: boolean
      closeDate: string | null
      churnDate: string | null
      communicatedChurnDate: string | null
      reasonForChurn: string | null
      lastContactDaysAgo: number
    }
    company: {
      serviceLevel: 'High' | 'Medium' | 'Low' | null
      usageHealth: 'Good' | 'Fair' | 'Poor' | 'None' | null
      churnRisk: boolean
      npsStatus: string | null
      totalActiveFlows: number
    }
    onboarding: {
      active: boolean
      daysInOnboarding: number
      stage: string | null
    }
    openTasks: number
    fathom: {
      summaries: string | null
      openActionItems: number
    }
  }
  contract: {
    start: string | null
    renewal: string | null
    ageMonths: number
  }
  renewalUrgent: boolean
  lastContactDaysAgo: number
  hubspotDealUrl: string
}

export function formatARR(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
