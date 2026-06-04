export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { Client, HealthState, CSMName, DEAL_STAGE_LABELS } from '@/lib/types'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

// ─── YOUR PIPELINE IDs ───────────────────────────────────────────────────────
// Visit /api/hubspot/debug?what=pipelines to verify these match your portal
const CONTRACTS_PIPELINE = '58017946'
const ONBOARDING_PIPELINE = '63371875'
const ONBOARDING_ACTIVE_STAGES = new Set([
  '1309169021','1309169022','1309169023','1309169024','1309169025',
])

// ─── HubSpot portal ID — used for building deal URLs ────────────────────────
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? '4938090'

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
    await sleep(1400 * (i + 1))
  }
  return fetch(`${HS}${path}`, { method: 'POST', headers: auth(), cache: 'no-store', body: JSON.stringify(body) })
}

async function hsGet(path: string): Promise<Response> {
  return fetch(`${HS}${path}`, { headers: auth(), cache: 'no-store' })
}

// Paginate through search endpoint — handles cursor pagination
async function searchAll(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = []
  let after: string | undefined
  do {
    const b = after ? { ...body, after } : body
    await sleep(300)
    const res = await hsPost(path, b)
    if (!res.ok) {
      console.error(`searchAll failed on ${path}:`, await res.text())
      break
    }
    const data = await res.json()
    results.push(...(data.results ?? []))
    after = data.paging?.next?.after
  } while (after)
  return results
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysAgo(s: string | null | undefined): number {
  if (!s) return 999
  const ms = Date.now() - new Date(s).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function daysUntil(s: string | null | undefined): number {
  if (!s) return 999
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000)
}

function ageMonths(s: string | null | undefined): number {
  if (!s) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / (86400000 * 30)))
}

// ─── Classification ───────────────────────────────────────────────────────────

function classify(
  stage: string,
  autoRenewal: boolean,
  closeDate: string | null,
  churnDate: string | null,
  lastDays: number,
  usage: string | null,
  flows: number,
  serviceLevel: string | null,
  churnFlag: boolean,
  inOB: boolean,
  obDays: number,
  tasks: number,
): { state: HealthState; rules: string[] } {

  // CHURN RISK (first match wins)
  if (stage === '1309169016') return { state: 'churn_risk', rules: ['communicated_churn_stage'] }
  if (churnFlag)              return { state: 'churn_risk', rules: ['churn_risk_flag'] }

  // ACTION REQUIRED
  if ((usage === 'None' || flows === 0) && lastDays > 40)
    return { state: 'action_required', rules: ['no_usage_40d'] }
  if (inOB && obDays > 90)
    return { state: 'action_required', rules: ['onboarding_90d'] }
  if (!autoRenewal && daysUntil(closeDate) < 100)
    return { state: 'action_required', rules: ['auto_renewal_false_close_100d'] }
  if (stage === '1309169014' && lastDays > 30)
    return { state: 'action_required', rules: ['up_for_renewal_no_contact_30d'] }
  if (churnDate && daysUntil(churnDate) > 0 && daysUntil(churnDate) < 15)
    return { state: 'action_required', rules: ['churn_date_15d'] }

  // KEEP AN EYE
  if (inOB)                   return { state: 'keep_an_eye', rules: ['onboarding_active'] }
  if (usage === 'Poor' || flows <= 1) return { state: 'keep_an_eye', rules: ['low_usage'] }
  if (stage === '1309169015') return { state: 'keep_an_eye', rules: ['renewal_in_progress'] }
  if (stage === '1309169017') return { state: 'keep_an_eye', rules: ['deal_paused'] }
  if (serviceLevel === 'High' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['high_service_no_contact_45d'] }
  if (tasks > 0)              return { state: 'keep_an_eye', rules: ['open_tasks'] }

  return { state: 'stable', rules: [] }
}

function toScore(state: HealthState, lastDays: number, flows: number): number {
  const base: Record<HealthState, number> = {
    stable: 82, keep_an_eye: 58, action_required: 36, churn_risk: 14,
  }
  let s = base[state]
  if (lastDays < 7)  s = Math.min(s + 6, 98)
  if (lastDays > 30) s = Math.max(s - 6, 5)
  if (flows > 5)     s = Math.min(s + 4, 98)
  return Math.round(s)
}

// ─── Owner name builder ───────────────────────────────────────────────────────
// HubSpot owners can have various name combinations — handle all cases
function ownerDisplayName(o: Record<string, unknown>): string {
  const first = String(o.firstName ?? '').trim()
  const last  = String(o.lastName  ?? '').trim()
  const email = String(o.email     ?? '')

  if (first && last) return `${first} ${last}`
  if (first)         return first
  if (last)          return last
  // Fall back to the part before @ in email
  const emailLocal = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  if (emailLocal)    return emailLocal
  return String(o.id ?? 'Unknown CSM')
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })
  }

  try {
    // ── 1. Fetch all customer companies ──────────────────────────────────────
    // We fetch all customers; CSM filtering is done client-side so the
    // frontend filter buttons work correctly without re-fetching.
    const companies = await searchAll('/crm/v3/objects/companies/search', {
      limit: 100,
      properties: [
        'name',
        'domain',
        // NOTE: hubspot_owner_id on the COMPANY is the sales owner, NOT the CSM.
        // We do NOT use it for CSM assignment — that comes from the deal owner below.
        // Usage health — exact field name confirmed from hubspot.json
        'usage_health__startdeliver_',
        // Service level — exact field name confirmed from hubspot.json
        'client_success_service_level',
        // Flows — exact field name confirmed from hubspot.json
        'total_active_flows',
        // Risk signals — confirmed from hubspot.json
        'churn_risk',
        'nps_status',
        'hs_csm_sentiment',
        // Contact recency on company level
        'notes_last_contacted',
        'notes_last_updated',
        'hs_notes_last_activity',
        // ARR / contract value — confirmed from hubspot.json
        'total_contract_value',
        'annualrevenue',
        // Subscription info
        'subscription_start_date',
        'subscription_start_date__first_contract_',
      ],
      filterGroups: [{
        filters: [{
          propertyName: 'lifecyclestage',
          operator: 'EQ',
          value: 'customer',
        }],
      }],
    })

    if (companies.length === 0) {
      // Return empty array with helpful debug info rather than crashing
      return NextResponse.json({
        clients: [],
        csmOwnerIds: [],
        debug: {
          message: '0 companies with lifecyclestage=customer found in HubSpot.',
          hint: 'Check that your companies have lifecyclestage set to "customer". Visit /api/hubspot/debug?what=companies for raw data.',
        },
      })
    }

    const coIds = companies.map(c => String(c.id))

    // ── 2. Associations: company → deals ─────────────────────────────────────
    await sleep(400)
    const assocRes = await hsPost('/crm/v4/associations/company/deal/batch/read', {
      inputs: coIds.map(id => ({ id })),
    })

    const coDealIds: Record<string, string[]> = {}
    if (assocRes.ok) {
      const assocData = await assocRes.json()
      for (const r of assocData.results ?? []) {
        const fromId = String(r.from?.id ?? '')
        const toIds  = (r.to ?? []).map((t: Record<string, unknown>) => String(t.id))
        if (fromId && toIds.length > 0) {
          coDealIds[fromId] = toIds
        }
      }
    } else {
      console.error('Associations failed:', await assocRes.text())
    }

    // ── 3. Batch-read all deals ───────────────────────────────────────────────
    const allDealIds = Array.from(new Set(Object.values(coDealIds).flat()))
    const dealPropsMap: Record<string, Record<string, string>> = {}

    if (allDealIds.length > 0) {
      await sleep(400)
      const dealsRes = await hsPost('/crm/v3/objects/deals/batch/read', {
        inputs: allDealIds.map(id => ({ id })),
        properties: [
          'dealname',
          'dealstage',
          'pipeline',
          'amount',
          'hs_acv',
          'hs_arr',
          'auto_renewal',
          'churn_date',
          'communicated_churn_date',
          'reason_for_churn',
          'closedate',
          // CSM owner on the deal — this is the source of truth for CSM assignment.
          // 'hubspot_owner_id' = the deal owner (should be the CSM on contract deals)
          // 'deal_closed_owner' = confirmed custom field "Deal closed owner (HubSpot)"
          'hubspot_owner_id',
          'deal_closed_owner',
          // Contact recency — exact field names confirmed from hubspot.json
          'notes_last_contacted',
          'notes_last_updated',
          'hs_notes_last_activity',
          'hs_sales_email_last_replied',
          'createdate',
        ],
      })

      if (dealsRes.ok) {
        const dealsData = await dealsRes.json()
        for (const d of dealsData.results ?? []) {
          dealPropsMap[String(d.id)] = d.properties ?? {}
        }
      } else {
        console.error('Deal batch read failed:', await dealsRes.text())
      }
    }

    // ── 4. Onboarding deals ───────────────────────────────────────────────────
    await sleep(400)
    const obDeals = await searchAll('/crm/v3/objects/deals/search', {
      limit: 100,
      properties: ['dealstage', 'createdate'],
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline',   operator: 'EQ',  value: ONBOARDING_PIPELINE },
          { propertyName: 'dealstage',  operator: 'NEQ', value: '1309169026' }, // exclude completed
        ],
      }],
    })

    const obCoMap: Record<string, { active: boolean; days: number; stage: string | null }> = {}
    if (obDeals.length > 0) {
      await sleep(400)
      const obAssoc = await hsPost('/crm/v4/associations/deal/company/batch/read', {
        inputs: obDeals.map(d => ({ id: String(d.id) })),
      })
      if (obAssoc.ok) {
        const obData = await obAssoc.json()
        for (const r of obData.results ?? []) {
          const coId = String(r.to?.[0]?.id ?? '')
          if (!coId) continue
          const dealId = String(r.from?.id ?? '')
          const obDeal = obDeals.find(d => String(d.id) === dealId)
          const dp = (obDeal?.properties as Record<string, string>) ?? {}
          obCoMap[coId] = {
            active: ONBOARDING_ACTIVE_STAGES.has(dp.dealstage ?? ''),
            days: Math.max(0, Math.floor((Date.now() - new Date(dp.createdate || Date.now()).getTime()) / 86400000)),
            stage: DEAL_STAGE_LABELS[dp.dealstage ?? ''] ?? dp.dealstage ?? null,
          }
        }
      }
    }

    // ── 5. Build owner map ────────────────────────────────────────────────────
    // FIX: Don't include deactivated owners — they pollute the CSM filter list.
    // FIX: Ensure keys are always strings so lookup never fails.
    const ownerMap: Record<string, string> = {}
    let ownerOffset = 0
    let ownerDone = false

    while (!ownerDone) {
      await sleep(200)
      // FIX: removed includeDeactivated=true — only active CSMs in filter bar
      const ownerRes = await hsGet(`/crm/v3/owners?limit=200&offset=${ownerOffset}`)
      if (!ownerRes.ok) break
      const ownerData = await ownerRes.json()
      const results = ownerData.results ?? []

      for (const o of results) {
        // FIX: always String(id) as key to guarantee type consistency
        const key = String(o.id)
        ownerMap[key] = ownerDisplayName(o as Record<string, unknown>)
      }

      if (results.length < 200) ownerDone = true
      else ownerOffset += 200
    }

    // ── 6. Map companies → Client objects ─────────────────────────────────────
    const clients: Client[] = companies.flatMap(co => {
      const cp = (co.properties as Record<string, string>) ?? {}
      const coId = String(co.id)

      // FIX: robust name — use domain as last resort
      const name = cp.name?.trim() || cp.domain?.trim() || null
      if (!name) return [] // skip nameless records (flatMap allows this)

      // Find the best contract deal:
      // 1. Prefer deals from CONTRACTS_PIPELINE
      // 2. Among those, pick highest ARR
      // 3. Fall back to ANY deal if no pipeline match (useful during setup)
      const dealIds = coDealIds[coId] ?? []
      const allDeals = dealIds.map(id => ({ id, props: dealPropsMap[id] })).filter(d => d.props)

      const contractDeals = allDeals
        .filter(d => d.props.pipeline === CONTRACTS_PIPELINE)
        .sort((a, b) => parseFloat(b.props.hs_arr || b.props.hs_acv || b.props.amount || '0')
                      - parseFloat(a.props.hs_arr || a.props.hs_acv || a.props.amount || '0'))

      // FIX: if no contract pipeline deal found, fall back to any deal sorted by ARR
      const fallbackDeals = allDeals
        .sort((a, b) => parseFloat(b.props.hs_arr || b.props.hs_acv || b.props.amount || '0')
                      - parseFloat(a.props.hs_arr || a.props.hs_acv || a.props.amount || '0'))

      const bestDeal = contractDeals[0] ?? fallbackDeals[0] ?? null
      const deal = bestDeal?.props ?? null
      const dealId = bestDeal?.id ?? null

      // ── CSM resolution ────────────────────────────────────────────────────
      // Source of truth: the deal's hubspot_owner_id (the person assigned to the
      // contract deal — this is the CSM). We never fall back to company owner
      // (hubspot_owner_id on the company) because that is the sales owner.
      //
      // deal_closed_owner is a custom enumeration field your portal uses for
      // the HubSpot-side deal closer — we use it as a secondary signal only
      // if the deal's hubspot_owner_id is empty.
      const dealOwnerId = String(deal?.hubspot_owner_id ?? '').trim()
      const ownerId = dealOwnerId  // never falls back to company owner
      const csm: CSMName = dealOwnerId
        ? (ownerMap[dealOwnerId] || dealOwnerId)
        : 'Unassigned'

      const stage = deal?.dealstage ?? ''
      const autoRenewal = deal?.auto_renewal === 'true'
      const closeDate = deal?.closedate?.split('T')[0] ?? null
      const churnDate = deal?.churn_date?.split('T')[0] ?? null

      // Pick the most recent contact date across all available fields.
      // Field names confirmed from hubspot.json schema.
      const contactDateCandidates = [
        deal?.notes_last_contacted,
        deal?.notes_last_updated,
        deal?.hs_notes_last_activity,
        deal?.hs_sales_email_last_replied,
        cp.notes_last_contacted,
        cp.notes_last_updated,
        cp.hs_notes_last_activity,
      ].filter(Boolean) as string[]

      const mostRecentContact = contactDateCandidates
        .map(d => new Date(d).getTime())
        .filter(t => !isNaN(t))
        .sort((a, b) => b - a)[0]

      const lastDays = mostRecentContact
        ? Math.max(0, Math.floor((Date.now() - mostRecentContact) / 86400000))
        : 999

      // Exact field names confirmed from hubspot.json
      const usage = cp['usage_health__startdeliver_'] as
        'Good' | 'Fair' | 'Poor' | 'None' | null ?? null

      const flows = parseInt(cp.total_active_flows || '0', 10) || 0

      const serviceLevel = cp.client_success_service_level as
        'High' | 'Medium' | 'Low' | null ?? null

      const churnFlag = cp.churn_risk === 'true'
      const ob = obCoMap[coId] ?? { active: false, days: 0, stage: null }

      // ARR: deal amount first, then company total_contract_value, then annualrevenue
      // Field names confirmed from hubspot.json
      const arr = parseFloat(
        deal?.hs_arr ||
        deal?.hs_acv ||
        deal?.amount ||
        cp.total_contract_value ||
        cp.annualrevenue ||
        '0'
      ) || 0

      // Contract start: prefer deal createdate, fall back to company subscription dates
      const contractStart = deal?.createdate?.split('T')[0]
        ?? cp.subscription_start_date
        ?? cp['subscription_start_date__first_contract_']
        ?? null

      const { state, rules } = classify(
        stage, autoRenewal, closeDate, churnDate, lastDays,
        usage, flows, serviceLevel, churnFlag,
        ob.active, ob.days, 0
      )
      const score = toScore(state, lastDays, flows)

      // Build score drivers
      const drivers: Client['scoreDrivers'] = []
      if (lastDays < 10)
        drivers.push({ label: `Contact ${lastDays}d ago`, type: 'positive', direction: 'stable' })
      if (lastDays >= 10 && lastDays <= 30)
        drivers.push({ label: `Contact ${lastDays}d ago`, type: 'neutral', direction: 'stable' })
      if (lastDays > 30)
        drivers.push({ label: `No contact ${lastDays}d`, type: lastDays > 45 ? 'critical' : 'negative', direction: 'declining' })
      if (usage)
        drivers.push({
          label: `Usage: ${usage}`,
          type: usage === 'Good' ? 'positive' : usage === 'Fair' ? 'neutral' : 'negative',
          direction: usage === 'Good' ? 'stable' : 'declining',
        })
      if (flows > 0)
        drivers.push({ label: `${flows} active flow${flows !== 1 ? 's' : ''}`, type: flows >= 3 ? 'positive' : 'neutral', direction: 'stable' })
      if (ob.active)
        drivers.push({ label: `Onboarding — day ${ob.days}`, type: 'neutral', direction: 'stable' })
      if (churnFlag)
        drivers.push({ label: 'Churn risk flagged', type: 'critical', direction: 'declining' })
      if (!autoRenewal && daysUntil(closeDate) < 100)
        drivers.push({ label: `No auto-renewal, closes in ${daysUntil(closeDate)}d`, type: 'negative', direction: 'declining' })
      if (stage === '1309169016')
        drivers.push({ label: 'Communicated churn', type: 'critical', direction: 'declining' })

      const actionMap: Record<HealthState, string> = {
        churn_risk:      'Initiate save play immediately. Escalate to management.',
        action_required: 'Contact today — prepare renewal proposal or usage intervention.',
        keep_an_eye:     'Schedule check-in this week. Review open items.',
        stable:          'Maintain cadence. Consider proactive QBR or upsell conversation.',
      }

      // Build HubSpot URL — prefer deal URL if we have a real deal, else company
      const hubspotDealUrl = dealId
        ? `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${dealId}`
        : `https://app.hubspot.com/contacts/${PORTAL_ID}/company/${coId}`

      return [{
        id: dealId ?? coId,
        companyId: coId,
        name,
        arr,
        currency: 'EUR',
        csm,
        csmOwnerId: ownerId,
        healthState: state,
        score,
        confidence: 72,
        whyThisScore: rules.length
          ? `Triggered: ${rules.join(', ')}. Last contact: ${lastDays === 999 ? 'never' : `${lastDays}d ago`}.`
          : `No negative signals. Usage: ${usage ?? 'unknown'}, flows: ${flows}, last contact: ${lastDays === 999 ? 'unknown' : `${lastDays}d ago`}.`,
        recommendedAction: actionMap[state],
        scoreDrivers: drivers.slice(0, 3),
        triggeredRules: rules,
        signals: {
          deal: {
            stage,
            stageLabel: DEAL_STAGE_LABELS[stage] ?? (stage || 'No contract deal'),
            autoRenewal,
            closeDate,
            churnDate,
            communicatedChurnDate: deal?.communicated_churn_date?.split('T')[0] ?? null,
            reasonForChurn: deal?.reason_for_churn ?? null,
            lastContactDaysAgo: lastDays,
          },
          company: {
            serviceLevel,
            usageHealth: usage,
            churnRisk: churnFlag,
            npsStatus: cp.nps_status ?? null,
            totalActiveFlows: flows,
          },
          onboarding: { active: ob.active, daysInOnboarding: ob.days, stage: ob.stage },
          openTasks: 0,
          fathom: { summaries: null, openActionItems: 0 },
        },
        contract: {
          start: contractStart,
          renewal: closeDate,
          ageMonths: ageMonths(contractStart ?? deal?.createdate),
        },
        renewalUrgent: daysUntil(closeDate) < 60 && daysUntil(closeDate) > 0,
        lastContactDaysAgo: lastDays,
        hubspotDealUrl,
      } as Client]
    })

    // Sort: churn first, then action, then keep_an_eye, then stable; by ARR within each
    const order: Record<HealthState, number> = {
      churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3,
    }
    clients.sort((a, b) => {
      if (order[a.healthState] !== order[b.healthState])
        return order[a.healthState] - order[b.healthState]
      return b.arr - a.arr
    })

    // Build CSM list for filter buttons — only people with 2+ accounts
    const ownerCount: Record<string, number> = {}
    for (const c of clients) {
      if (c.csmOwnerId) ownerCount[c.csmOwnerId] = (ownerCount[c.csmOwnerId] ?? 0) + 1
    }

    const csmOwnerIds = Object.entries(ownerCount)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => ({ name: ownerMap[id] ?? id, ownerId: id }))

    return NextResponse.json({ clients, csmOwnerIds })

  } catch (err) {
    console.error('HubSpot companies route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
