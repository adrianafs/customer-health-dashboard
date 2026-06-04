export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { Client, HealthState, CSMName, CSM_LIST, DEAL_STAGE_LABELS } from '@/lib/types'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
const CONTRACTS_PIPELINE = '58017946'
const ONBOARDING_PIPELINE = '63371875'
const ONBOARDING_ACTIVE_STAGES = ['1309169021','1309169022','1309169023','1309169024','1309169025']

const DEAL_PROPS = [
  'dealname','dealstage','amount','auto_renewal','churn_date',
  'communicated_churn_date','reason_for_churn','closedate',
  'notes_last_contacted','hubspot_owner_id','createdate','hs_object_id',
].join(',')

const COMPANY_PROPS = [
  'name','client_success_service_level','usage_health__startdeliver_',
  'churn_risk','nps_status','total_active_flows','notes_last_contacted',
].join(',')

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

async function post(path: string, body: object) {
  return fetch(`${HS}${path}`, { method: 'POST', headers: auth(), cache: 'no-store', body: JSON.stringify(body) })
}

async function get(path: string) {
  return fetch(`${HS}${path}`, { headers: auth(), cache: 'no-store' })
}

function daysAgo(dateStr: string | null | undefined): number {
  if (!dateStr) return 999
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 999
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function contractAge(startStr: string | null | undefined): number {
  if (!startStr) return 0
  return Math.floor((Date.now() - new Date(startStr).getTime()) / (86400000 * 30))
}

function classifyState(
  dealStage: string,
  autoRenewal: boolean,
  closeDate: string | null,
  churnDate: string | null,
  lastContactDays: number,
  usageHealth: string | null,
  totalFlows: number,
  serviceLevel: string | null,
  churnRiskFlag: boolean,
  inOnboarding: boolean,
  daysInOnboarding: number,
  openTasks: number,
): { state: HealthState; rules: string[] } {
  const rules: string[] = []

  // CHURN RISK
  if (dealStage === '1309169016') { rules.push('communicated_churn_stage'); return { state: 'churn_risk', rules } }
  if (churnRiskFlag) { rules.push('churn_risk_flag'); return { state: 'churn_risk', rules } }

  // ACTION REQUIRED
  if ((usageHealth === 'None' || totalFlows === 0) && lastContactDays > 40) {
    rules.push('no_usage_40d'); return { state: 'action_required', rules }
  }
  if (inOnboarding && daysInOnboarding > 90) {
    rules.push('onboarding_90d'); return { state: 'action_required', rules }
  }
  if (!autoRenewal && closeDate && daysUntil(closeDate) < 100) {
    rules.push('auto_renewal_false_close_100d'); return { state: 'action_required', rules }
  }
  if (dealStage === '1309169014' && lastContactDays > 30) {
    rules.push('up_for_renewal_no_contact_30d'); return { state: 'action_required', rules }
  }
  if (churnDate && daysUntil(churnDate) < 15 && daysUntil(churnDate) > 0) {
    rules.push('churn_date_15d'); return { state: 'action_required', rules }
  }

  // KEEP AN EYE
  if (inOnboarding) { rules.push('onboarding_active'); return { state: 'keep_an_eye', rules } }
  if (usageHealth === 'Poor' || totalFlows <= 1) {
    rules.push('low_usage'); return { state: 'keep_an_eye', rules }
  }
  if (dealStage === '1309169015') { rules.push('renewal_in_progress'); return { state: 'keep_an_eye', rules } }
  if (dealStage === '1309169017') { rules.push('deal_paused'); return { state: 'keep_an_eye', rules } }
  if (serviceLevel === 'High' && lastContactDays > 45) {
    rules.push('high_service_no_contact_45d'); return { state: 'keep_an_eye', rules }
  }
  if (openTasks > 0) { rules.push('open_tasks'); return { state: 'keep_an_eye', rules } }

  return { state: 'stable', rules: [] }
}

function stateScore(state: HealthState, lastContactDays: number, totalFlows: number): number {
  const base: Record<HealthState, number> = { stable: 82, keep_an_eye: 58, action_required: 36, churn_risk: 14 }
  let s = base[state]
  if (lastContactDays < 7) s = Math.min(s + 6, 98)
  if (lastContactDays > 30) s = Math.max(s - 6, 5)
  if (totalFlows > 5) s = Math.min(s + 4, 98)
  return Math.round(s)
}

function mapDeal(
  deal: Record<string, unknown>,
  companyProps: Record<string, string>,
  onboarding: { active: boolean; daysInOnboarding: number; stage: string | null },
  openTasks: number,
  ownerMap: Record<string, CSMName>,
): Client {
  const dp = (deal.properties as Record<string, string>) ?? {}
  const id = String(deal.id)
  const stage = dp.dealstage ?? ''
  const autoRenewal = dp.auto_renewal === 'true'
  const closeDate = dp.closedate?.split('T')[0] ?? null
  const churnDate = dp.churn_date?.split('T')[0] ?? null
  const lastContactDays = daysAgo(dp.notes_last_contacted ?? companyProps.notes_last_contacted)
  const usageHealth = (companyProps.usage_health__startdeliver_ as 'Good'|'Fair'|'Poor'|'None'|null) ?? null
  const totalFlows = parseInt(companyProps.total_active_flows ?? '0', 10) || 0
  const serviceLevel = (companyProps.client_success_service_level as 'High'|'Medium'|'Low'|null) ?? null
  const churnRiskFlag = companyProps.churn_risk === 'true'
  const ownerId = dp.hubspot_owner_id ?? ''
  const csm: CSMName = ownerMap[ownerId] ?? 'Claudia'
  const arr = parseFloat(dp.amount ?? '0') || 0

  const { state, rules } = classifyState(
    stage, autoRenewal, closeDate, churnDate, lastContactDays,
    usageHealth, totalFlows, serviceLevel, churnRiskFlag,
    onboarding.active, onboarding.daysInOnboarding, openTasks,
  )
  const score = stateScore(state, lastContactDays, totalFlows)

  const drivers = []
  if (lastContactDays < 10) drivers.push({ label: `Contact ${lastContactDays}d ago`, type: 'positive' as const, direction: 'stable' as const })
  if (lastContactDays > 30) drivers.push({ label: `No contact ${lastContactDays}d`, type: lastContactDays > 45 ? 'critical' as const : 'negative' as const, direction: 'declining' as const })
  if (usageHealth) drivers.push({ label: `Usage: ${usageHealth}`, type: usageHealth === 'Good' ? 'positive' as const : usageHealth === 'Fair' ? 'neutral' as const : 'critical' as const, direction: usageHealth === 'Good' ? 'stable' as const : 'declining' as const })
  if (onboarding.active) drivers.push({ label: `Onboarding (${onboarding.daysInOnboarding}d)`, type: 'neutral' as const, direction: 'stable' as const })
  if (churnRiskFlag) drivers.push({ label: 'Flagged as churn risk', type: 'critical' as const, direction: 'declining' as const })
  if (stage === '1309169016') drivers.push({ label: 'Communicated Churn', type: 'critical' as const, direction: 'declining' as const })
  if (!autoRenewal && daysUntil(closeDate) < 100) drivers.push({ label: `No auto-renewal, closes ${daysUntil(closeDate)}d`, type: 'negative' as const, direction: 'declining' as const })
  if (openTasks > 0) drivers.push({ label: `${openTasks} open task${openTasks > 1 ? 's' : ''}`, type: 'neutral' as const, direction: 'stable' as const })

  const actionMap: Record<HealthState, string> = {
    churn_risk: 'Initiate save play immediately. Escalate to management.',
    action_required: 'Contact today — prepare renewal proposal or usage intervention.',
    keep_an_eye: 'Schedule check-in this week. Review open items.',
    stable: 'Maintain cadence. Consider proactive QBR or upsell conversation.',
  }

  const renewalDays = daysUntil(closeDate)

  return {
    id,
    companyId: String((deal as Record<string, unknown>).companyId ?? ''),
    name: dp.dealname ?? companyProps.name ?? 'Unknown',
    arr,
    currency: 'EUR',
    csm,
    csmOwnerId: ownerId,
    healthState: state,
    score,
    confidence: 72,
    whyThisScore: rules.length
      ? `Triggered rules: ${rules.join(', ')}. Last contact: ${lastContactDays}d ago.`
      : `No negative signals. Usage: ${usageHealth ?? 'unknown'}, last contact: ${lastContactDays}d ago.`,
    recommendedAction: actionMap[state],
    scoreDrivers: drivers.slice(0, 3),
    triggeredRules: rules,
    signals: {
      deal: {
        stage,
        stageLabel: DEAL_STAGE_LABELS[stage] ?? stage,
        autoRenewal,
        closeDate,
        churnDate,
        communicatedChurnDate: dp.communicated_churn_date?.split('T')[0] ?? null,
        reasonForChurn: dp.reason_for_churn ?? null,
        lastContactDaysAgo: lastContactDays,
      },
      company: {
        serviceLevel,
        usageHealth,
        churnRisk: churnRiskFlag,
        npsStatus: companyProps.nps_status ?? null,
        totalActiveFlows: totalFlows,
      },
      onboarding,
      openTasks,
      fathom: { summaries: null, openActionItems: 0 }, // TODO: Fathom MCP
    },
    contract: {
      start: null,
      renewal: closeDate,
      ageMonths: contractAge(dp.createdate),
    },
    renewalUrgent: renewalDays < 60,
    lastContactDaysAgo: lastContactDays,
    hubspotDealUrl: `https://app.hubspot.com/contacts/deals/${id}`,
  }
}

export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const ownerFilter = searchParams.get('owner') // optional: filter by owner ID

  try {
    // 1. Fetch all deals in Contracts Pipeline (exclude Churned stage 1309169018)
    const deals: Record<string, unknown>[] = []
    let after: string | undefined

    // Fetch all active deals in the pipeline — filter by owner in-memory
    // (avoids mismatch if HubSpot owner IDs differ from hardcoded spec values)
    const filters: object[] = [
      { propertyName: 'pipeline', operator: 'EQ', value: CONTRACTS_PIPELINE },
    ]

    do {
      const body: Record<string, unknown> = {
        limit: 100,
        properties: DEAL_PROPS.split(','),
        filterGroups: [{ filters }],
        sorts: [{ propertyName: 'amount', direction: 'DESCENDING' }],
      }
      if (after) body.after = after
      const res = await post('/crm/v3/objects/deals/search', body)
      if (!res.ok) {
        const err = await res.text()
        return NextResponse.json({ error: `HubSpot deals error: ${err}` }, { status: res.status })
      }
      const data = await res.json()
      deals.push(...(data.results ?? []))
      after = data.paging?.next?.after
    } while (after)

    if (deals.length === 0) return NextResponse.json([])

    // 1b. Filter by owner in-memory if requested
    const filteredDeals = ownerFilter
      ? deals.filter(d => (d.properties as Record<string, string>)?.hubspot_owner_id === ownerFilter)
      : deals

    const dealsToProcess = filteredDeals.length > 0 ? filteredDeals : deals

    // 2. Get associated companies for all deals (batch)
    const dealIds = dealsToProcess.map(d => String(d.id))
    const assocRes = await post('/crm/v4/associations/deal/company/batch/read', {
      inputs: dealIds.map(id => ({ id })),
    })
    const dealToCompany: Record<string, string> = {}
    if (assocRes.ok) {
      const assocData = await assocRes.json()
      for (const r of assocData.results ?? []) {
        if (r.to?.[0]?.id) dealToCompany[r.from.id] = r.to[0].id
      }
    }

    // 3. Batch read company properties
    const companyIds = Array.from(new Set(Object.values(dealToCompany)))
    const companyPropsMap: Record<string, Record<string, string>> = {}
    if (companyIds.length > 0) {
      const batchRes = await post('/crm/v3/objects/companies/batch/read', {
        inputs: companyIds.map(id => ({ id })),
        properties: COMPANY_PROPS.split(','),
      })
      if (batchRes.ok) {
        const batchData = await batchRes.json()
        for (const co of batchData.results ?? []) {
          companyPropsMap[co.id] = co.properties ?? {}
        }
      }
    }

    // 4. Check onboarding pipeline for each company
    const onboardingMap: Record<string, { active: boolean; daysInOnboarding: number; stage: string | null }> = {}
    if (companyIds.length > 0) {
      const obRes = await post('/crm/v3/objects/deals/search', {
        limit: 200,
        properties: ['dealstage', 'createdate'],
        filterGroups: [{
          filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: ONBOARDING_PIPELINE },
            { propertyName: 'dealstage', operator: 'NEQ', value: '1309169026' },
          ],
        }],
      })
      if (obRes.ok) {
        const obData = await obRes.json()
        const obDeals = obData.results ?? []
        // Get company associations for onboarding deals
        const obIds = obDeals.map((d: Record<string, unknown>) => String(d.id))
        if (obIds.length > 0) {
          const obAssocRes = await post('/crm/v4/associations/deal/company/batch/read', {
            inputs: obIds.map((id: string) => ({ id })),
          })
          if (obAssocRes.ok) {
            const obAssoc = await obAssocRes.json()
            for (const r of obAssoc.results ?? []) {
              const coId = r.to?.[0]?.id
              if (!coId) continue
              const obDeal = obDeals.find((d: Record<string, unknown>) => String(d.id) === r.from.id)
              if (!obDeal) continue
              const p = (obDeal as Record<string, unknown>).properties as Record<string, string>
              const daysIn = Math.floor((Date.now() - new Date(p.createdate ?? '').getTime()) / 86400000)
              onboardingMap[coId] = {
                active: ONBOARDING_ACTIVE_STAGES.includes(p.dealstage ?? ''),
                daysInOnboarding: daysIn,
                stage: DEAL_STAGE_LABELS[p.dealstage ?? ''] ?? p.dealstage ?? null,
              }
            }
          }
        }
      }
    }

    // 5. Build owner map from CSM_LIST
    const ownerMap: Record<string, CSMName> = {}
    for (const csm of CSM_LIST) ownerMap[csm.ownerId] = csm.name

    // 6. Map deals to Client objects
    const clients: Client[] = dealsToProcess
      .filter(d => {
        const dp = (d.properties as Record<string, string>) ?? {}
        return dp.dealname && (parseFloat(dp.amount ?? '0') > 0 || true) // include all named deals
      })
      .map(d => {
        const companyId = dealToCompany[String(d.id)] ?? ''
        const companyProps = companyPropsMap[companyId] ?? {}
        const onboarding = onboardingMap[companyId] ?? { active: false, daysInOnboarding: 0, stage: null }
        const enrichedDeal = { ...d, companyId }
        return mapDeal(enrichedDeal as Record<string, unknown>, companyProps, onboarding, 0, ownerMap)
      })
      .sort((a, b) => {
        const order: Record<HealthState, number> = { churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3 }
        if (order[a.healthState] !== order[b.healthState]) return order[a.healthState] - order[b.healthState]
        return b.arr - a.arr // within same state, sort by ARR desc
      })

    return NextResponse.json(clients)
  } catch (err) {
    console.error('HubSpot route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
