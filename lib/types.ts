export type HealthState = 'stable' | 'keep_an_eye' | 'action_required' | 'churn_risk'

export type SignalDriver = {
  label: string
  type: 'positive' | 'neutral' | 'negative' | 'critical'
  direction?: 'improving' | 'stable' | 'declining'
}

export type CSMName = string

export const CSM_LIST: { name: CSMName; ownerId: string }[] = []
export const CSM_BY_OWNER_ID: Record<string, string> = {}

export const DEAL_STAGE_LABELS: Record<string, string> = {
  // Contracts pipeline (58017946) — real stage IDs confirmed from portal
  '115681793': 'Contract not started',
  '114969751': 'Active Contract',
  '114969752': 'Up for Renewal',
  '114969753': 'Renewal in Progress',
  '114969754': 'Communicated Churn (in Winback)',
  '115288434': 'Paused',
  '114969757': 'Churned',
  '114969756': 'Closed Won (Renewed)',
  // Onboarding pipeline (63371875) — real stage IDs confirmed from portal
  '1007128757': 'Handover',
  '124085898':  'Onboarding Kick-off',
  '124085899':  'Implementation',
  '124085900':  'Stuck in Onboarding',
  '124085901':  'Client Live',
  '124085902':  'Implementation Review Done',
  '124085903':  'Client Fully Onboarded',
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
