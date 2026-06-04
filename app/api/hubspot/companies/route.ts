export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { Client, HealthState, CSMName, CSM_LIST, DEAL_STAGE_LABELS } from '@/lib/types'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
const CONTRACTS_PIPELINE = '58017946'
const ONBOARDING_PIPELINE = '63371875'
const ONBOARDING_ACTIVE_STAGES = new Set(['1309169021','1309169022','1309169023','1309169024','1309169025'])

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

async function hsPost(path: string, body: object, retries = 4): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`${HS}${path}`, {
      method: 'POST', headers: auth(), cache: 'no-store', body: JSON.stringify(body),
    })
    if (res.status !== 429) return res
    await sleep(1200 * (i + 1))
  }
  return fetch(`${HS}${path}`, { method: 'POST', headers: auth(), cache: 'no-store', body: JSON.stringify(body) })
}

async function hsGet(path: string): Promise<Response> {
  return fetch(`${HS}${path}`, { headers: auth(), cache: 'no-store' })
}

async function searchAll(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = []
  let after: string | undefined
  do {
    const b = after ? { ...body, after } : body
    await sleep(300)
    const res = await hsPost(path, b)
    if (!res.ok) break
    const data = await res.json()
    results.push(...(data.results ?? []))
    after = data.paging?.next?.after
  } while (after)
  return results
}

// ─── Classification helpers ───────────────────────────────────────────────────

function daysAgo(s: string | null | undefined) {
  if (!s) return 999
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000)
}
function daysUntil(s: string | null | undefined) {
  if (!s) return 999
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000)
}
function ageMonths(s: string | null | undefined) {
  if (!s) return 0
  return Math.floor((Date.now() - new Date(s).getTime()) / (86400000 * 30))
}

function classify(
  stage: string, autoRenewal: boolean, closeDate: string | null, churnDate: string | null,
  lastDays: number, usage: string | null, flows: number, serviceLevel: string | null,
  churnFlag: boolean, inOB: boolean, obDays: number, tasks: number,
): { state: HealthState; rules: string[] } {
  const rules: string[] = []
  // CHURN RISK
  if (stage === '1309169016') return { state: 'churn_risk', rules: ['communicated_churn_stage'] }
  if (churnFlag) return { state: 'churn_risk', rules: ['churn_risk_flag'] }
  // ACTION REQUIRED
  if ((usage === 'None' || flows === 0) && lastDays > 40) return { state: 'action_required', rules: ['no_usage_40d'] }
  if (inOB && obDays > 90) return { state: 'action_required', rules: ['onboarding_90d'] }
  if (!autoRenewal && daysUntil(closeDate) < 100) return { state: 'action_required', rules: ['auto_renewal_false_close_100d'] }
  if (stage === '1309169014' && lastDays > 30) return { state: 'action_required', rules: ['up_for_renewal_no_contact_30d'] }
  if (churnDate && daysUntil(churnDate) > 0 && daysUntil(churnDate) < 15) return { state: 'action_required', rules: ['churn_date_15d'] }
  // KEEP AN EYE
  if (inOB) return { state: 'keep_an_eye', rules: ['onboarding_active'] }
  if (usage === 'Poor' || flows <= 1) return { state: 'keep_an_eye', rules: ['low_usage'] }
  if (stage === '1309169015') return { state: 'keep_an_eye', rules: ['renewal_in_progress'] }
  if (stage === '1309169017') return { state: 'keep_an_eye', rules: ['deal_paused'] }
  if (serviceLevel === 'High' && lastDays > 45) return { state: 'keep_an_eye', rules: ['high_service_no_contact_45d'] }
  if (tasks > 0) return { state: 'keep_an_eye', rules: ['open_tasks'] }
  return { state: 'stable', rules }
}

function toScore(state: HealthState, lastDays: number, flows: number) {
  const base: Record<HealthState, number> = { stable: 82, keep_an_eye: 58, action_required: 36, churn_risk: 14 }
  let s = base[state]
  if (lastDays < 7) s = Math.min(s + 6, 98)
  if (lastDays > 30) s = Math.max(s - 6, 5)
  if (flows > 5) s = Math.min(s + 4, 98)
  return Math.round(s)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  const ownerFilter = new URL(req.url).searchParams.get('owner')

  try {
    // 1. Fetch ALL customer companies (lifecyclestage = customer) — always unfiltered
    // CSM filtering is done on the frontend using the deal's owner ID
    const companies = await searchAll('/crm/v3/objects/companies/search', {
      limit: 100,
      properties: [
        'name','hubspot_owner_id','client_success_service_level',
        'usage_health__startdeliver_','churn_risk','nps_status',
        'total_active_flows','notes_last_contacted','total_contract_value',
      ],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
    })

    if (companies.length === 0) return NextResponse.json([])

    const coIds = companies.map(c => String(c.id))

    // 2. Get contract deals for each company (associations: company → deals)
    await sleep(400)
    const assocRes = await hsPost('/crm/v4/associations/company/deal/batch/read', {
      inputs: coIds.map(id => ({ id })),
    })
    const coDealIds: Record<string, string[]> = {} // companyId → dealIds
    if (assocRes.ok) {
      const assocData = await assocRes.json()
      for (const r of assocData.results ?? []) {
        coDealIds[r.from.id] = (r.to ?? []).map((t: Record<string, unknown>) => String(t.id))
      }
    }

    // 3. Batch-read all deals we found
    const allDealIds = Array.from(new Set(Object.values(coDealIds).flat()))
    const dealPropsMap: Record<string, Record<string, string>> = {}
    if (allDealIds.length > 0) {
      await sleep(400)
      const dealsRes = await hsPost('/crm/v3/objects/deals/batch/read', {
        inputs: allDealIds.map(id => ({ id })),
        properties: ['dealname','dealstage','pipeline','amount','auto_renewal','churn_date',
          'communicated_churn_date','reason_for_churn','closedate','notes_last_contacted',
          'hubspot_owner_id','createdate'],
      })
      if (dealsRes.ok) {
        const dealsData = await dealsRes.json()
        for (const d of dealsData.results ?? []) {
          dealPropsMap[d.id] = d.properties ?? {}
        }
      }
    }

    // 4. Fetch onboarding deals
    await sleep(400)
    const obDeals = await searchAll('/crm/v3/objects/deals/search', {
      limit: 100,
      properties: ['dealstage','createdate'],
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline', operator: 'EQ', value: ONBOARDING_PIPELINE },
          { propertyName: 'dealstage', operator: 'NEQ', value: '1309169026' },
        ],
      }],
    })
    // Map onboarding deal → company
    const obCoMap: Record<string, { active: boolean; days: number; stage: string | null }> = {}
    if (obDeals.length > 0) {
      await sleep(400)
      const obAssoc = await hsPost('/crm/v4/associations/deal/company/batch/read', {
        inputs: obDeals.map(d => ({ id: String(d.id) })),
      })
      if (obAssoc.ok) {
        const obData = await obAssoc.json()
        for (const r of obData.results ?? []) {
          const coId = r.to?.[0]?.id
          if (!coId) continue
          const dp = (obDeals.find(d => String(d.id) === r.from.id)?.properties as Record<string, string>) ?? {}
          obCoMap[coId] = {
            active: ONBOARDING_ACTIVE_STAGES.has(dp.dealstage ?? ''),
            days: Math.floor((Date.now() - new Date(dp.createdate ?? '').getTime()) / 86400000),
            stage: DEAL_STAGE_LABELS[dp.dealstage ?? ''] ?? dp.dealstage ?? null,
          }
        }
      }
    }

    // 5. Build owner map
    const ownerMap: Record<string, CSMName> = {}
    for (const csm of CSM_LIST) ownerMap[csm.ownerId] = csm.name

    // 6. Map companies → Client objects
    const clients: Client[] = companies.map(co => {
      const cp = (co.properties as Record<string, string>) ?? {}
      const coId = String(co.id)

      // Find the best contract deal (prefer Contracts pipeline, take highest ARR)
      const dealIds = coDealIds[coId] ?? []
      const contractDeals = dealIds
        .map(id => dealPropsMap[id])
        .filter(Boolean)
        .filter(d => d.pipeline === CONTRACTS_PIPELINE)
        .sort((a, b) => parseFloat(b.amount ?? '0') - parseFloat(a.amount ?? '0'))

      const deal = contractDeals[0] ?? null
      const dealId = dealIds.find(id => dealPropsMap[id] === deal) ?? coId

      // Use deal owner if present, else company owner
      const ownerId = deal?.hubspot_owner_id ?? cp.hubspot_owner_id ?? ''
      const csm: CSMName = ownerMap[ownerId] ?? 'Claudia'

      const stage = deal?.dealstage ?? ''
      const autoRenewal = deal?.auto_renewal === 'true'
      const closeDate = deal?.closedate?.split('T')[0] ?? null
      const churnDate = deal?.churn_date?.split('T')[0] ?? null
      const lastDays = daysAgo(deal?.notes_last_contacted ?? cp.notes_last_contacted)
      const usage = (cp.usage_health__startdeliver_ as 'Good'|'Fair'|'Poor'|'None'|null) ?? null
      const flows = parseInt(cp.total_active_flows ?? '0', 10) || 0
      const serviceLevel = (cp.client_success_service_level as 'High'|'Medium'|'Low'|null) ?? null
      const churnFlag = cp.churn_risk === 'true'
      const ob = obCoMap[coId] ?? { active: false, days: 0, stage: null }
      const arr = parseFloat(deal?.amount ?? cp.total_contract_value ?? '0') || 0

      const { state, rules } = classify(stage, autoRenewal, closeDate, churnDate, lastDays, usage, flows, serviceLevel, churnFlag, ob.active, ob.days, 0)
      const score = toScore(state, lastDays, flows)

      const drivers = []
      if (lastDays < 10) drivers.push({ label: `Contact ${lastDays}d ago`, type: 'positive' as const, direction: 'stable' as const })
      if (lastDays > 30) drivers.push({ label: `No contact ${lastDays}d`, type: lastDays > 45 ? 'critical' as const : 'negative' as const, direction: 'declining' as const })
      if (usage) drivers.push({ label: `Usage: ${usage}`, type: usage === 'Good' ? 'positive' as const : usage === 'Fair' ? 'neutral' as const : 'negative' as const, direction: usage === 'Good' ? 'stable' as const : 'declining' as const })
      if (ob.active) drivers.push({ label: `Onboarding (${ob.days}d)`, type: 'neutral' as const, direction: 'stable' as const })
      if (churnFlag) drivers.push({ label: 'Churn risk flagged', type: 'critical' as const, direction: 'declining' as const })
      if (!autoRenewal && daysUntil(closeDate) < 100) drivers.push({ label: `No auto-renewal, closes ${daysUntil(closeDate)}d`, type: 'negative' as const, direction: 'declining' as const })

      const actionMap: Record<HealthState, string> = {
        churn_risk: 'Initiate save play immediately. Escalate to management.',
        action_required: 'Contact today — prepare renewal proposal or usage intervention.',
        keep_an_eye: 'Schedule check-in this week. Review open items.',
        stable: 'Maintain cadence. Consider proactive QBR or upsell conversation.',
      }

      return {
        id: dealId,
        companyId: coId,
        name: cp.name ?? 'Unknown',
        arr,
        currency: 'EUR',
        csm,
        csmOwnerId: ownerId,
        healthState: state,
        score,
        confidence: 72,
        whyThisScore: rules.length
          ? `Triggered: ${rules.join(', ')}. Last contact: ${lastDays}d ago.`
          : `No negative signals. Usage: ${usage ?? 'unknown'}, last contact: ${lastDays}d ago.`,
        recommendedAction: actionMap[state],
        scoreDrivers: drivers.slice(0, 3),
        triggeredRules: rules,
        signals: {
          deal: {
            stage,
            stageLabel: DEAL_STAGE_LABELS[stage] ?? (stage ? stage : 'No contract deal'),
            autoRenewal,
            closeDate,
            churnDate,
            communicatedChurnDate: deal?.communicated_churn_date?.split('T')[0] ?? null,
            reasonForChurn: deal?.reason_for_churn ?? null,
            lastContactDaysAgo: lastDays,
          },
          company: { serviceLevel, usageHealth: usage, churnRisk: churnFlag, npsStatus: cp.nps_status ?? null, totalActiveFlows: flows },
          onboarding: { active: ob.active, daysInOnboarding: ob.days, stage: ob.stage },
          openTasks: 0,
          fathom: { summaries: null, openActionItems: 0 },
        },
        contract: {
          start: null,
          renewal: closeDate,
          ageMonths: ageMonths(deal?.createdate),
        },
        renewalUrgent: daysUntil(closeDate) < 60,
        lastContactDaysAgo: lastDays,
        hubspotDealUrl: deal
          ? `https://app.hubspot.com/contacts/4938090/deal/${dealId}`
          : `https://app.hubspot.com/contacts/4938090/company/${coId}`,
      } as Client
    })
    .filter(c => c.name !== 'Unknown')
    .sort((a, b) => {
      const order: Record<HealthState, number> = { churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3 }
      if (order[a.healthState] !== order[b.healthState]) return order[a.healthState] - order[b.healthState]
      return b.arr - a.arr
    })

    return NextResponse.json(clients)
  } catch (err) {
    console.error('HubSpot route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
