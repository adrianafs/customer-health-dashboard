export type HealthState = 'stable' | 'moderate' | 'action_required' | 'churn_risk'

export type SignalDriver = {
  label: string
  type: 'positive' | 'neutral' | 'negative' | 'critical'
}

export function formatARR(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export type Client = {
  id: string
  name: string
  arr: number
  currency: string
  csm: 'Adriana' | 'Claudia'
  healthState: HealthState
  score: number
  confidence: number
  whyThisScore: string
  recommendedAction: string
  scoreDrivers: SignalDriver[]
  isOnboarding?: boolean
  signals: {
    hubspot: {
      openTickets: number
      emails30d: number
      emails90d: number
      lastEmailIn: string
      lastEmailOut: string
    }
    usage: {
      posts30d: number
      approved30d: number
      distributed30d: number
      rightsRequests30d: number
      lastActiveDay: string | null
    }
    chargebee: {
      status: 'active' | 'non_renewing' | 'in_trial' | 'paused' | 'cancelled'
      contractEnd: string
      cancelScheduled: boolean
      dueInvoices: number
      totalDues: number
    }
    fathom: {
      sentiment: string | null
    }
  }
  contract: {
    start: string
    renewal: string
    ageMonths: number
  }
  renewalUrgent: boolean
  lastContactDaysAgo: number
}
