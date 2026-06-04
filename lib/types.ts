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
  // Contracts pipeline (874052773) — portal 8988558
  '1309169012': 'Contract not started',
  '1309169013': 'Active Contract',
  '1309169014': 'Up for Renewal',
  '1309169015': 'Renewal in Progress',
  '1309169016': 'Communicated Churn (in Winback)',
  '1309169017': 'Paused',
  '1309169018': 'Churned',
  '1309169019': 'Closed Won (Renewed)',
  // Onboarding pipeline (874052774) — portal 8988558
  '1309169021': 'Onboarding Kick-off',
  '1309169022': 'Implementation',
  '1309169023': 'Stuck in Onboarding',
  '1309169024': 'Client Live',
  '1309169025': 'Implementation Review Done',
  '1309169026': 'Client Fully Onboarded',
}

export type Client = {
  id: string          // deal ID
  companyId: string
  name: string
  arr: number
  currency: string
  csm: CSMName
  csmOwnerId: string
  // Brand: which Flowbox product this deal is for
  // 'flowbox' = Visual UGC, 'dream' = Influencer Marketing, 'both' = Full Suite
  // null = field not found in HubSpot yet
  brand: 'flowbox' | 'dream' | 'both' | null
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
    noticePeriodMonths: string | null
  }
  renewalUrgent: boolean
  lastContactDaysAgo: number
  hubspotDealUrl: string
  childCompanies?: string[]
}

export function formatARR(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
