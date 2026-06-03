import { NextResponse } from 'next/server'
import { Client, HealthState } from '@/lib/types'

const HS_BASE = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

const COMPANY_PROPERTIES = [
  'name',
  'hubspot_owner_id',
  'total_contract_value',
  'agreement_status',
  'nps_status',
  'notes_last_contacted',
  'churn_risk',
  'subscription_start_date',
  'churn_date',
  'flowbox_platform_id',
  'hs_object_id',
  'num_associated_contacts',
].join(',')

function hs(path: string) {
  return fetch(`${HS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    next: { revalidate: 300 }, // cache 5 min
  })
}

async function fetchAllOwners(): Promise<Record<string, string>> {
  const res = await hs('/crm/v3/owners?limit=100')
  if (!res.ok) return {}
  const data = await res.json()
  const map: Record<string, string> = {}
  for (const o of data.results ?? []) {
    map[String(o.id)] = o.firstName ?? o.email ?? 'Unknown'
  }
  return map
}

async function fetchOpenTicketCounts(companyIds: string[]): Promise<Record<string, number>> {
  if (companyIds.length === 0) return {}
  // Batch associations: up to 100 per request
  const chunks = []
  for (let i = 0; i < companyIds.length; i += 50) {
    chunks.push(companyIds.slice(i, i + 50))
  }
  const counts: Record<string, number> = {}
  for (const chunk of chunks) {
    // Use batch read associations: companies → tickets
    const res = await fetch(`${HS_BASE}/crm/v4/associations/company/ticket/batch/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: chunk.map(id => ({ id })) }),
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const r of data.results ?? []) {
      counts[r.from.id] = (r.to ?? []).length
    }
  }
  return counts
}

function daysAgo(dateStr: string | null | undefined): number {
  if (!dateStr) return 999
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function contractAgeMonths(startStr: string | null | undefined): number {
  if (!startStr) return 0
  const ms = Date.now() - new Date(startStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 30))
}

function daysToRenewal(churnDateStr: string | null | undefined): number {
  if (!churnDateStr) return 999
  // churn_date = end + 1 day, so renewal = churn_date - 1 day
  const renewal = new Date(churnDateStr)
  renewal.setDate(renewal.getDate() - 1)
  return Math.ceil((renewal.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function inferHealthState(p: Record<string, string>, openTickets: number, lastContactDays: number): HealthState {
  const churnRisk = p.churn_risk === 'true'
  const status = p.agreement_status ?? ''
  const nps = p.nps_status ?? ''
  const dtRenewal = daysToRenewal(p.churn_date)

  if (churnRisk || status === 'Communicated Churn (in Winback)') return 'churn_risk'
  if (status === 'Churned') return 'churn_risk'
  if (nps === 'Onboarding') return 'moderate'
  if (lastContactDays > 30 || (openTickets > 0 && lastContactDays > 14)) return 'action_required'
  if (dtRenewal < 45 || lastContactDays > 14) return 'moderate'
  return 'stable'
}

function inferScore(state: HealthState, lastContactDays: number, openTickets: number, dtRenewal: number): number {
  const base: Record<HealthState, [number, number]> = {
    stable: [75, 95],
    moderate: [50, 70],
    action_required: [30, 48],
    churn_risk: [10, 28],
  }
  const [lo, hi] = base[state]
  // Simple heuristic within the band
  let score = Math.round((lo + hi) / 2)
  if (lastContactDays < 7) score = Math.min(hi, score + 5)
  if (lastContactDays > 20) score = Math.max(lo, score - 5)
  if (openTickets > 0) score = Math.max(lo, score - 3)
  if (dtRenewal < 30) score = Math.max(lo, score - 4)
  return score
}

function mapToClient(
  company: Record<string, unknown>,
  owners: Record<string, string>,
  openTickets: number,
): Client {
  const p = (company.properties as Record<string, string>) ?? {}
  const id = String(company.id)
  const lastContactDays = daysAgo(p.notes_last_contacted)
  const dtRenewal = daysToRenewal(p.churn_date)
  const ownerName = owners[p.hubspot_owner_id] ?? 'Unknown'
  // Map owner first name to Adriana/Claudia — extend this as needed
  const csm: 'Adriana' | 'Claudia' = ownerName.toLowerCase().includes('adriana') ? 'Adriana' : 'Claudia'
  const state = inferHealthState(p, openTickets, lastContactDays)
  const score = inferScore(state, lastContactDays, openTickets, dtRenewal)
  const arr = parseFloat(p.total_contract_value ?? '0') || 0
  const ageMonths = contractAgeMonths(p.subscription_start_date)
  const churnDateStr = p.churn_date ?? ''
  const renewalDate = churnDateStr
    ? (() => { const d = new Date(churnDateStr); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0] })()
    : 'Unknown'

  const drivers = []
  if (lastContactDays < 7) drivers.push({ label: 'Recent contact', type: 'positive' as const })
  if (lastContactDays > 20) drivers.push({ label: `No contact in ${lastContactDays}d`, type: lastContactDays > 30 ? 'critical' as const : 'negative' as const })
  if (openTickets > 0) drivers.push({ label: `${openTickets} open ticket${openTickets > 1 ? 's' : ''}`, type: 'negative' as const })
  if (p.churn_risk === 'true') drivers.push({ label: 'Flagged as churn risk', type: 'critical' as const })
  if (dtRenewal < 60) drivers.push({ label: `Renews in ${dtRenewal}d`, type: dtRenewal < 30 ? 'critical' as const : 'negative' as const })
  if (p.nps_status === 'Onboarding') drivers.push({ label: 'Currently onboarding', type: 'neutral' as const })
  if (drivers.length === 0) drivers.push({ label: 'No urgent signals', type: 'positive' as const })

  return {
    id,
    name: p.name ?? 'Unknown',
    arr,
    currency: 'EUR',
    csm,
    healthState: state,
    score,
    confidence: 70,
    whyThisScore: `Based on live HubSpot data: last contact ${lastContactDays}d ago, ${openTickets} open ticket(s), contract status: ${p.agreement_status ?? 'unknown'}.`,
    recommendedAction: state === 'churn_risk' ? 'Initiate save play immediately.' :
      state === 'action_required' ? 'Contact today — check open tickets and usage.' :
      state === 'moderate' ? 'Monitor closely and schedule check-in.' :
      'Maintain current cadence.',
    scoreDrivers: drivers.slice(0, 4),
    isOnboarding: p.nps_status === 'Onboarding',
    signals: {
      hubspot: {
        openTickets,
        emails30d: 0, // TODO: fetch from engagements API
        emails90d: 0,
        lastEmailIn: p.notes_last_contacted ? `${lastContactDays}d ago` : 'Unknown',
        lastEmailOut: 'Unknown',
      },
      usage: {
        // TODO: connect to core.main.ugc_company_level_usage WHERE ugc_company_id = flowbox_platform_id
        posts30d: 0,
        approved30d: 0,
        distributed30d: 0,
        rightsRequests30d: 0,
        lastActiveDay: null,
      },
      chargebee: {
        // TODO: connect to core.main.chargebee_subscriptions
        status: p.agreement_status === 'Active Contract' ? 'active' :
                p.agreement_status === 'Communicated Churn (in Winback)' ? 'non_renewing' :
                p.agreement_status === 'Paused' ? 'paused' :
                p.agreement_status === 'Churned' ? 'cancelled' : 'active',
        contractEnd: renewalDate,
        cancelScheduled: p.churn_risk === 'true' || p.agreement_status === 'Communicated Churn (in Winback)',
        dueInvoices: 0,
        totalDues: 0,
      },
      fathom: { sentiment: null },
    },
    contract: {
      start: p.subscription_start_date?.split('T')[0] ?? 'Unknown',
      renewal: renewalDate,
      ageMonths,
    },
    renewalUrgent: dtRenewal < 60,
    lastContactDaysAgo: lastContactDays,
  }
}

export async function GET() {
  if (!TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })
  }

  try {
    // 1. Fetch all customer companies (paginated)
    const companies: Record<string, unknown>[] = []
    let after: string | undefined

    do {
      const url = `/crm/v3/objects/companies?limit=100&properties=${COMPANY_PROPERTIES}&filterGroups=[{"filters":[{"propertyName":"lifecyclestage","operator":"EQ","value":"customer"}]}]${after ? `&after=${after}` : ''}`
      const res = await hs(url)
      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: `HubSpot error: ${err}` }, { status: res.status })
      }
      const data = await res.json()
      companies.push(...(data.results ?? []))
      after = data.paging?.next?.after
    } while (after)

    // 2. Resolve owners and ticket counts in parallel
    const companyIds = companies.map(c => String(c.id))
    const [owners, ticketCounts] = await Promise.all([
      fetchAllOwners(),
      fetchOpenTicketCounts(companyIds),
    ])

    // 3. Map to Client shape
    const clients: Client[] = companies
      .map(c => mapToClient(c, owners, ticketCounts[String(c.id)] ?? 0))
      .filter(c => c.arr > 0) // skip companies with no contract value
      .sort((a, b) => {
        const order: Record<HealthState, number> = { churn_risk: 0, action_required: 1, moderate: 2, stable: 3 }
        return order[a.healthState] - order[b.healthState]
      })

    return NextResponse.json(clients)
  } catch (err) {
    console.error('HubSpot API error:', err)
    return NextResponse.json({ error: 'Failed to fetch from HubSpot' }, { status: 500 })
  }
}
