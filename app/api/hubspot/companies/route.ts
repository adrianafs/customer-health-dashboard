export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { Client, HealthState, CSMName, DEAL_STAGE_LABELS } from '@/lib/types'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

// ─── Pipeline IDs (confirmed via /api/hubspot/debug) ─────────────────────────
const CONTRACTS_PIPELINE  = '58017946'
const ONBOARDING_PIPELINE = '63371875'

// Onboarding stages that mean "still being onboarded"
// Excludes 124085903 = Client Fully Onboarded
const ONBOARDING_ACTIVE_STAGES = new Set([
  '1007128757', // Handover
  '124085898',  // Onboarding Kick-off
  '124085899',  // Implementation
  '124085900',  // Stuck in Onboarding
  '124085901',  // Client Live
  '124085902',  // Implementation Review Done
])

// Contract stages to exclude from the dashboard entirely
const EXCLUDED_STAGES = new Set([
  '114969757', // Churned
  '115681793', // Contract not started
])

// ─── HubSpot portal ID ────────────────────────────────────────────────────────
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
  return Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000))
}

function daysUntil(s: string | null | undefined): number {
  if (!s) return 999
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000)
}

function ageMonths(s: string | null | undefined): number {
  if (!s) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / (86400000 * 30)))
}

// ─── Classification (Claudia's rules, priority order) ────────────────────────
// NOTE: Platform usage rules (§3.5 external endpoint) are stubbed — they will
//       be wired once Claudia confirms the Databricks/Amplitude endpoint URL.
//       usage_health__startdeliver_ is NOT used (unreliable per spec §12).

function classify(params: {
  stage: string
  autoRenewal: boolean
  subscriptionEndDate: string | null   // subscription_end_date on deal
  pauseEndDate: string | null          // pause_end_date on deal (stage 1309169017)
  churnDate: string | null             // churn_date on deal (stage 1309169016)
  lastDays: number                     // days since last contact
  serviceLevel: string | null          // client_success_service_level on company
  churnFlag: boolean                   // churn_risk on company
  inOB: boolean                        // has active onboarding deal
  obDays: number                       // days since onboarding deal createdate
}): { state: HealthState; rules: string[] } {
  const {
    stage, autoRenewal, subscriptionEndDate, pauseEndDate, churnDate,
    lastDays, serviceLevel, churnFlag, inOB, obDays,
  } = params

  // ── CHURN RISK ─────────────────────────────────────────────────────────────
  // 1. churn_risk flag on company
  if (churnFlag) return { state: 'churn_risk', rules: ['churn_risk_flag'] }
  // 2. Communicated Churn stage — assume winback possible until Claude says otherwise
  //    (Claude-based winback detection is phase 2; conservative = churn_risk now)
  if (stage === '114969754') return { state: 'churn_risk', rules: ['communicated_churn_stage'] }

  // ── ACTION REQUIRED ────────────────────────────────────────────────────────
  // Onboarding > 90 days in Implementation stage
  if (inOB && obDays > 90 && stage === '124085899')
    return { state: 'action_required', rules: ['onboarding_implementation_90d'] }
  // Auto-renewal off + < 100 days to subscription end
  if (!autoRenewal && daysUntil(subscriptionEndDate) < 100)
    return { state: 'action_required', rules: ['auto_renewal_false_sub_end_100d'] }
  // Up for Renewal + no contact in 30 days
  if (stage === '114969752' && lastDays > 30)
    return { state: 'action_required', rules: ['up_for_renewal_no_contact_30d'] }
  // Renewal in Progress + ≤45 days to subscription end
  if (stage === '114969753' && daysUntil(subscriptionEndDate) <= 45)
    return { state: 'action_required', rules: ['renewal_in_progress_sub_end_45d'] }

  // ── KEEP AN EYE ────────────────────────────────────────────────────────────
  // Any active onboarding (not fully onboarded)
  if (inOB) return { state: 'keep_an_eye', rules: ['onboarding_active'] }
  // High service level + no contact in 45 days
  if (serviceLevel === 'High' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['high_service_no_contact_45d'] }
  // Up for Renewal + no contact in 45 days (30-day threshold already caught above as action_required)
  if (stage === '114969752' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['up_for_renewal_no_contact_45d'] }
  // Renewal in Progress (without urgency — ≤45d already caught as action_required)
  if (stage === '114969753')
    return { state: 'keep_an_eye', rules: ['renewal_in_progress'] }
  // Paused + ≤30 days to pause end
  if (stage === '115288434' && daysUntil(pauseEndDate) <= 30)
    return { state: 'keep_an_eye', rules: ['paused_end_30d'] }

  // ── STABLE (default) ──────────────────────────────────────────────────────
  // Includes: Active Contract, Closed Won (Renewed), Paused > 30d to end, etc.
  return { state: 'stable', rules: [] }
}

function toScore(state: HealthState, lastDays: number): number {
  const base: Record<HealthState, number> = {
    stable: 82, keep_an_eye: 58, action_required: 36, churn_risk: 14,
  }
  let s = base[state]
  if (lastDays < 7)  s = Math.min(s + 6, 98)
  if (lastDays > 30) s = Math.max(s - 6, 5)
  return Math.round(s)
}

// ─── Owner name builder ───────────────────────────────────────────────────────
function ownerDisplayName(o: Record<string, unknown>): string {
  const first = String(o.firstName ?? '').trim()
  const last  = String(o.lastName  ?? '').trim()
  const email = String(o.email     ?? '')
  if (first && last) return `${first} ${last}`
  if (first)         return first
  if (last)          return last
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
    // ── 1. Fetch customer companies ───────────────────────────────────────────
    const companies = await searchAll('/crm/v3/objects/companies/search', {
      limit: 100,
      properties: [
        'name',
        'domain',
        // deal_closed_owner = "Deal closed owner (HubSpot)" — authoritative CSM field
        'deal_closed_owner',
        // Service level for 45-day no-contact rule
        'client_success_service_level',
        // Risk signals
        'churn_risk',
        'nps_status',
        // Contact recency (backup when deal has no value)
        'notes_last_contacted',
        'notes_last_updated',
        'hs_notes_last_activity',
        // ARR fallback
        'total_contract_value',
        'annualrevenue',
        // Subscription dates fallback
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
      return NextResponse.json({
        clients: [],
        csmOwnerIds: [],
        debug: { message: '0 companies with lifecyclestage=customer found in HubSpot.' },
      })
    }

    const coIds = companies.map(c => String(c.id))

    // ── 2 & 3. Fetch Contracts pipeline deals directly (much faster than
    //           loading all deals and filtering) ────────────────────────────
    // dealPropsMap: dealId → properties
    // coFromDeal:   dealId → companyId (reverse lookup for matching)
    const dealPropsMap: Record<string, Record<string, string>> = {}
    const coFromDeal:  Record<string, string> = {}

    const contractDealsRaw = await searchAll('/crm/v3/objects/deals/search', {
      limit: 100,
      properties: [
        'dealname', 'dealstage', 'pipeline', 'amount', 'hs_acv', 'hs_arr',
        'auto_renewal', 'subscription_end_date', 'pause_end_date',
        'churn_date', 'communicated_churn_date', 'reason_for_churn', 'closedate',
        'hubspot_owner_id', 'deal_closed_owner',
        'notes_last_contacted', 'notes_last_updated', 'hs_notes_last_activity',
        'hs_sales_email_last_replied', 'createdate',
      ],
      filterGroups: [{
        filters: [{ propertyName: 'pipeline', operator: 'EQ', value: CONTRACTS_PIPELINE }],
      }],
    })

    for (const d of contractDealsRaw) {
      dealPropsMap[String(d.id)] = (d.properties as Record<string, string>) ?? {}
    }

    // Associate those deals back to companies (chunked, 100 per request)
    const contractDealIds = Object.keys(dealPropsMap)
    const coDealIds: Record<string, string[]> = {} // companyId → dealIds

    for (let i = 0; i < contractDealIds.length; i += 100) {
      const chunk = contractDealIds.slice(i, i + 100)
      await sleep(300)
      const assocRes = await hsPost('/crm/v4/associations/deal/company/batch/read', {
        inputs: chunk.map(id => ({ id })),
      })
      if (assocRes.ok) {
        const assocData = await assocRes.json()
        for (const r of assocData.results ?? []) {
          const dealId = String(r.from?.id ?? '')
          const toObj  = r.to?.[0] as Record<string, unknown> | undefined
          const coId   = String(toObj?.toObjectId ?? toObj?.id ?? '')
          if (dealId && coId) {
            coFromDeal[dealId] = coId
            coDealIds[coId] = [...(coDealIds[coId] ?? []), dealId]
          }
        }
      }
    }

    // ── 4. Onboarding deals ───────────────────────────────────────────────────
    await sleep(400)
    const obDeals = await searchAll('/crm/v3/objects/deals/search', {
      limit: 100,
      properties: ['dealstage', 'createdate'],
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline',  operator: 'EQ',  value: ONBOARDING_PIPELINE },
          { propertyName: 'dealstage', operator: 'NEQ', value: '124085903' }, // exclude Client Fully Onboarded
        ],
      }],
    })

    const obCoMap: Record<string, { active: boolean; days: number; stage: string | null }> = {}
    if (obDeals.length > 0) {
      for (let i = 0; i < obDeals.length; i += 100) {
        const chunk = obDeals.slice(i, i + 100)
        await sleep(300)
        const obAssoc = await hsPost('/crm/v4/associations/deal/company/batch/read', {
          inputs: chunk.map(d => ({ id: String(d.id) })),
        })
        if (obAssoc.ok) {
          const obData = await obAssoc.json()
          for (const r of obData.results ?? []) {
            const toObj = r.to?.[0] as Record<string, unknown> | undefined
            const coId = String(toObj?.toObjectId ?? toObj?.id ?? '')
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
    }

    // ── 5. Build owner map (live from HubSpot owners API) ─────────────────────
    const ownerMap: Record<string, string> = {}
    let ownerOffset = 0
    let ownerDone = false

    while (!ownerDone) {
      await sleep(200)
      const ownerRes = await hsGet(`/crm/v3/owners?limit=200&offset=${ownerOffset}`)
      if (!ownerRes.ok) break
      const ownerData = await ownerRes.json()
      const results = ownerData.results ?? []

      for (const o of results) {
        const name  = ownerDisplayName(o as Record<string, unknown>)
        const idStr = String(o.id)
        ownerMap[idStr] = name
        if (o.userId && String(o.userId) !== idStr) ownerMap[String(o.userId)] = name
      }

      if (results.length < 200) ownerDone = true
      else ownerOffset += 200
    }

    // ── 6. Map companies → Client objects ─────────────────────────────────────
    const clients: Client[] = companies.flatMap(co => {
      const cp    = (co.properties as Record<string, string>) ?? {}
      const coId  = String(co.id)
      const name  = cp.name?.trim() || cp.domain?.trim() || null
      if (!name) return []

      // Best contract deal: prefer Contracts pipeline, highest ARR
      const dealIds = coDealIds[coId] ?? []
      const allDeals = dealIds.map(id => ({ id, props: dealPropsMap[id] })).filter(d => d.props)

      const contractDeals = allDeals
        .filter(d => d.props.pipeline === CONTRACTS_PIPELINE)
        // Exclude churned and not-started stages
        .filter(d => !EXCLUDED_STAGES.has(d.props.dealstage ?? ''))
        .sort((a, b) =>
          parseFloat(b.props.hs_arr || b.props.hs_acv || b.props.amount || '0') -
          parseFloat(a.props.hs_arr || a.props.hs_acv || a.props.amount || '0'))

      // If no valid contract deal, skip this company
      if (contractDeals.length === 0) return []

      const bestDeal = contractDeals[0]
      const deal     = bestDeal.props
      const dealId   = bestDeal.id

      // ── CSM resolution ────────────────────────────────────────────────────
      // hubspot_owner_id on the deal is always a numeric owner ID → use for
      // filtering and ownerMap lookup.
      // deal_closed_owner on the company is an enumeration that may return a
      // label string rather than an ID, so we only use it as a display-name
      // fallback when the ownerMap lookup fails.
      const csmOwnerId = String(deal.hubspot_owner_id ?? '').trim()

      const csm: CSMName = csmOwnerId
        ? (ownerMap[csmOwnerId] ?? (String(cp.deal_closed_owner ?? '').trim() || `Unknown (${csmOwnerId})`))
        : 'Unassigned'

      // ── Date fields ───────────────────────────────────────────────────────
      const stage              = deal.dealstage ?? ''
      const autoRenewal        = deal.auto_renewal === 'true'
      // subscription_end_date is the authoritative contract end date per spec §3.1
      // Fall back to closedate if the field is empty
      const subscriptionEndDate =
        deal.subscription_end_date?.split('T')[0] ??
        deal.closedate?.split('T')[0] ??
        null
      const pauseEndDate       = deal.pause_end_date?.split('T')[0] ?? null
      const churnDate          = deal.churn_date?.split('T')[0] ?? null

      // Most recent contact date — deal > company (per spec §12 note 5)
      const contactCandidates = [
        deal.notes_last_contacted,
        deal.notes_last_updated,
        deal.hs_notes_last_activity,
        deal.hs_sales_email_last_replied,
        cp.notes_last_contacted,
        cp.notes_last_updated,
        cp.hs_notes_last_activity,
      ].filter(Boolean) as string[]

      const mostRecentMs = contactCandidates
        .map(d => new Date(d).getTime())
        .filter(t => !isNaN(t))
        .sort((a, b) => b - a)[0]

      const lastDays = mostRecentMs
        ? Math.max(0, Math.floor((Date.now() - mostRecentMs) / 86400000))
        : 999

      // Service level
      const serviceLevel = cp.client_success_service_level as 'High' | 'Medium' | 'Low' | null ?? null
      const churnFlag    = cp.churn_risk === 'true'
      const ob           = obCoMap[coId] ?? { active: false, days: 0, stage: null }

      // ARR
      const arr = parseFloat(
        deal.hs_arr || deal.hs_acv || deal.amount ||
        cp.total_contract_value || cp.annualrevenue || '0'
      ) || 0

      // Contract start
      const contractStart =
        deal.createdate?.split('T')[0] ??
        cp.subscription_start_date ??
        cp['subscription_start_date__first_contract_'] ??
        null

      // ── Classify ─────────────────────────────────────────────────────────
      const { state, rules } = classify({
        stage, autoRenewal, subscriptionEndDate, pauseEndDate, churnDate,
        lastDays, serviceLevel, churnFlag, inOB: ob.active, obDays: ob.days,
      })
      const score = toScore(state, lastDays)

      // ── Score drivers (visible in UI) ─────────────────────────────────────
      const drivers: Client['scoreDrivers'] = []
      if (lastDays < 10)
        drivers.push({ label: `Contact ${lastDays}d ago`, type: 'positive', direction: 'stable' })
      else if (lastDays <= 30)
        drivers.push({ label: `Contact ${lastDays}d ago`, type: 'neutral', direction: 'stable' })
      else
        drivers.push({ label: `No contact ${lastDays}d`, type: lastDays > 45 ? 'critical' : 'negative', direction: 'declining' })

      if (serviceLevel)
        drivers.push({ label: `Service: ${serviceLevel}`, type: serviceLevel === 'High' ? 'neutral' : 'positive', direction: 'stable' })
      if (ob.active)
        drivers.push({ label: `Onboarding — day ${ob.days}`, type: 'neutral', direction: 'stable' })
      if (churnFlag)
        drivers.push({ label: 'Churn risk flagged', type: 'critical', direction: 'declining' })
      if (!autoRenewal && daysUntil(subscriptionEndDate) < 100)
        drivers.push({ label: `No auto-renewal, ends in ${daysUntil(subscriptionEndDate)}d`, type: 'negative', direction: 'declining' })
      if (stage === '114969754')
        drivers.push({ label: 'Communicated churn', type: 'critical', direction: 'declining' })
      if (stage === '115288434')
        drivers.push({ label: pauseEndDate ? `Paused — resumes ${pauseEndDate}` : 'Paused', type: 'neutral', direction: 'stable' })
      if (stage === '114969756')
        drivers.push({ label: 'Renewed', type: 'positive', direction: 'improving' })

      const actionMap: Record<HealthState, string> = {
        churn_risk:      'Initiate save play immediately. Escalate to management.',
        action_required: 'Contact today — prepare renewal proposal or usage intervention.',
        keep_an_eye:     'Schedule check-in this week. Review open items.',
        stable:          'Maintain cadence. Consider proactive QBR or upsell conversation.',
      }

      const hubspotDealUrl = `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${dealId}`

      return [{
        id: dealId,
        companyId: coId,
        name,
        arr,
        currency: 'EUR',
        csm,
        csmOwnerId,
        healthState: state,
        score,
        confidence: 72,
        whyThisScore: rules.length
          ? `Triggered: ${rules.join(', ')}. Last contact: ${lastDays === 999 ? 'never' : `${lastDays}d ago`}.`
          : `No negative signals. Last contact: ${lastDays === 999 ? 'unknown' : `${lastDays}d ago`}.`,
        recommendedAction: actionMap[state],
        scoreDrivers: drivers.slice(0, 3),
        triggeredRules: rules,
        signals: {
          deal: {
            stage,
            stageLabel: DEAL_STAGE_LABELS[stage] ?? (stage || 'No contract deal'),
            autoRenewal,
            closeDate: subscriptionEndDate,
            churnDate,
            communicatedChurnDate: deal.communicated_churn_date?.split('T')[0] ?? null,
            reasonForChurn: deal.reason_for_churn ?? null,
            lastContactDaysAgo: lastDays,
          },
          company: {
            serviceLevel,
            usageHealth: null, // usage_health__startdeliver_ excluded per spec §12
            churnRisk: churnFlag,
            npsStatus: cp.nps_status ?? null,
            totalActiveFlows: 0, // replaced by external usage endpoint (phase 2)
          },
          onboarding: { active: ob.active, daysInOnboarding: ob.days, stage: ob.stage },
          openTasks: 0,
          fathom: { summaries: null, openActionItems: 0 },
        },
        contract: {
          start: contractStart,
          renewal: subscriptionEndDate,
          ageMonths: ageMonths(contractStart ?? deal.createdate),
        },
        renewalUrgent: daysUntil(subscriptionEndDate) > 0 && daysUntil(subscriptionEndDate) < 60,
        lastContactDaysAgo: lastDays,
        hubspotDealUrl,
      } as Client]
    })

    // Sort: churn → action → keep_an_eye → stable; by ARR within each group
    const order: Record<HealthState, number> = {
      churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3,
    }
    clients.sort((a, b) => {
      if (order[a.healthState] !== order[b.healthState])
        return order[a.healthState] - order[b.healthState]
      return b.arr - a.arr
    })

    // CSM filter list — owners with 2+ accounts
    const ownerCount: Record<string, number> = {}
    for (const c of clients) {
      if (c.csmOwnerId) ownerCount[c.csmOwnerId] = (ownerCount[c.csmOwnerId] ?? 0) + 1
    }

    const csmOwnerIds = Object.entries(ownerCount)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => ({ name: ownerMap[id] ?? id, ownerId: id }))

    // ── Debug: explain empty results ─────────────────────────────────────────
    if (clients.length === 0) {
      let noDeals = 0, wrongPipeline = 0, allExcluded = 0
      for (const co of companies) {
        const coId = String(co.id)
        const dealIds = coDealIds[coId] ?? []
        if (dealIds.length === 0) { noDeals++; continue }
        const allDeals = dealIds.map(id => ({ id, props: dealPropsMap[id] })).filter(d => d.props)
        if (allDeals.length === 0) { noDeals++; continue }
        const contractDeals = allDeals.filter(d => d.props.pipeline === CONTRACTS_PIPELINE)
        if (contractDeals.length === 0) { wrongPipeline++; continue }
        const validDeals = contractDeals.filter(d => !EXCLUDED_STAGES.has(d.props.dealstage ?? ''))
        if (validDeals.length === 0) { allExcluded++; continue }
      }
      const sampleDealId = Object.values(coDealIds).flat()[0]
      const sampleDeal = sampleDealId ? dealPropsMap[sampleDealId] : null
      return NextResponse.json({
        clients: [],
        csmOwnerIds: [],
        _debug: {
          companiesFound: companies.length,
          dealIdsFound: Object.values(coDealIds).flat().length,
          dealPropsLoaded: Object.keys(dealPropsMap).length,
          noDeals,
          wrongPipeline,
          allExcluded,
          contractsPipelineId: CONTRACTS_PIPELINE,
          sampleDealProps: sampleDeal,
        },
      })
    }

    return NextResponse.json({ clients, csmOwnerIds })

  } catch (err) {
    console.error('HubSpot companies route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
