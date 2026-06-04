export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { Client, HealthState, CSMName, DEAL_STAGE_LABELS } from '@/lib/types'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

// ─── Pipeline IDs (confirmed via /api/hubspot/diagnose) ──────────────────────
const CONTRACTS_PIPELINE  = '58017946'
const ONBOARDING_PIPELINE = '63371875'

// Onboarding stages = still being onboarded (excludes 124085903 = Fully Onboarded)
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

// ─── HubSpot portal ID — used for building deal URLs ─────────────────────────
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? '8988558'

// ─── Owner ID → name map ──────────────────────────────────────────────────────
// IDs come from the HubSpot owners API (/crm/v3/owners) — each user gets a
// unique numeric ID visible in their HubSpot profile URL.
// Source file: HubSpot_User_IDs.xlsx
const OWNER_NAMES: Record<string, string> = {
  '80974218': 'Nina Brown',
  '70541122': 'Ellisif Bendiksen',
  '87809160': 'Jean Bouaziz',
  '81375028': 'Amber Williams',
  '81275041': 'Hajo Oldewelt',
  '27676528': 'Analicia Montealegre',
  '46571243': 'Soufiane El Mardi',
  '81605073': 'David Kupfer',
  '88759156': 'Raghunath Vasireddy',
  '79209473': 'Amin Durani',
  '90574444': 'Oliver Hovstadius',
  '71103443': 'Olivia Gonzalez Basanta',
  '85008554': 'Tage Almark',
  '65671669': 'Vinicio Oliveira',
  '7359612':  'Oktawia Gardecka',
  '69434237': 'Cecile Gautier',
  '46571229': 'Chantal van den Berg',
  '7587005':  'Jordi Sintes',
  '91858010': 'Lawrence Langley',
  '76033697': 'Ørjan Christiansen',
  '86814062': 'Thibaud Delaunay',
  '73109042': 'Kristian Frederiksen Pedersen',
  '2762423':  'Sof Michaels',
  '78103049': 'Jana Khoraizat',
  '83251257': 'Jeno Toth',
  '71337806': 'Tatiana Lozano',
  '76033686': 'Robin Sand',
  '64994666':  'Claudia Núñez',
  '82166106':  'Claudia Núñez',
  '1918285936':'Claudia Núñez',
  '66551551': 'Isabel Fugmann',
  '62715576': 'Sophia Garner Rønne',
  '87061202': 'Lucia Fuentes',
  '65666643': 'Laura Marie Ravn',
  '91858012': 'Rana Cherkaoui',
  '76033612': 'Johannes Ipland',
  '75827652': 'Sophia Jonsson',
  '50700746': 'Paula Puga Sanz',
  '59466511': 'Sandra Vinsa',
  '10527094': 'Sergi Mulero',
  '72382253': 'Samuel Wadström',
  '91858011': 'Ollie Ivarsson',
  '46571222': 'Frida Lindqvist',
  '69329949': 'Dennis Schjødt Hansen',
  '68615816': 'Michael Kent Christensen',
  '90574443': 'Jonas Gebre-Medhin',
  '46895807': 'Christina Holm',
  '24985003': 'Cristina Baeza',
  '45862700': 'René Plesner',
  '59783520': 'Morten Frank',
  '87957608': 'Elena Garcia Molina',
  '78103070': 'Signe Manniche Larsen',
  '45190234': 'Roel Hoedemakers',
  '25758215': 'Markus Bergendorff',
  '90092479': 'Enric Martínez',
  '44847211': 'Mads Wedderkopp',
  '1596054':  'Ben Heinkel',
  '11386606': 'Emeline Lucas',
  '47685461': 'David Hansson',
  '897219':   'Eulogi Bordas',
  '69116560': 'Maja Kjellson',
  '5332601':  'Davy Laudet',
  '25169562': 'Rasmus Tobiasen',
  '24704465': 'Derek van Grieken',
  '27040998': 'Louis Theodor',
  '65666661': 'Peter Linné',
  '82367576': 'Bruna Schmidt',
  '92933356': 'Johannes Gustafsson',
  '8640563':  'Mikkel Malesa',
  '62715596': 'Ola Bortnowska',
  '90050587': 'Jerry de Waart',
}

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

function daysUntil(s: string | null | undefined): number {
  if (!s) return 999
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000)
}

function ageMonths(s: string | null | undefined): number {
  if (!s) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / (86400000 * 30)))
}

// ─── Classification (Claudia's rules — confirmed stage IDs from portal) ───────

function classify(
  stage: string,
  autoRenewal: boolean,
  subscriptionEndDate: string | null,
  pauseEndDate: string | null,
  churnDate: string | null,
  lastDays: number,
  serviceLevel: string | null,
  churnFlag: boolean,
  inOB: boolean,
  obDays: number,
): { state: HealthState; rules: string[] } {

  // ── CHURN RISK ──────────────────────────────────────────────────────────────
  if (churnFlag)              return { state: 'churn_risk', rules: ['churn_risk_flag'] }
  if (stage === '114969754')  return { state: 'churn_risk', rules: ['communicated_churn_stage'] }

  // ── ACTION REQUIRED ─────────────────────────────────────────────────────────
  if (inOB && obDays > 90 && stage === '124085899')
    return { state: 'action_required', rules: ['onboarding_implementation_90d'] }
  if (!autoRenewal && daysUntil(subscriptionEndDate) < 100)
    return { state: 'action_required', rules: ['auto_renewal_false_sub_end_100d'] }
  if (stage === '114969752' && lastDays > 30)
    return { state: 'action_required', rules: ['up_for_renewal_no_contact_30d'] }
  if (stage === '114969753' && daysUntil(subscriptionEndDate) <= 45)
    return { state: 'action_required', rules: ['renewal_in_progress_sub_end_45d'] }

  // ── KEEP AN EYE ─────────────────────────────────────────────────────────────
  if (inOB)                   return { state: 'keep_an_eye', rules: ['onboarding_active'] }
  if (serviceLevel === 'High' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['high_service_no_contact_45d'] }
  if (stage === '114969752' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['up_for_renewal_no_contact_45d'] }
  if (stage === '114969753')  return { state: 'keep_an_eye', rules: ['renewal_in_progress'] }
  if (stage === '115288434' && daysUntil(pauseEndDate) <= 30)
    return { state: 'keep_an_eye', rules: ['paused_end_30d'] }

  // ── STABLE (default) ────────────────────────────────────────────────────────
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

function ownerName(id: string | null | undefined): string {
  if (!id) return 'Unassigned'
  const clean = String(id).trim().replace(/\.0$/, '')
  return OWNER_NAMES[clean] ?? `Unknown (${clean})`
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })
  }

  try {
    // ── 1. Customer companies ─────────────────────────────────────────────────
    const companies = await searchAll('/crm/v3/objects/companies/search', {
      limit: 100,
      properties: [
        'name', 'domain',
        'client_success_service_level',
        'churn_risk', 'nps_status',
        // notes_last_contacted: updated when CSM logs a call/email/meeting
        // hs_last_activity_date: updated by any engagement incl. on contact records
        'notes_last_contacted', 'hs_last_activity_date',
        'total_contract_value', 'annualrevenue',
        'subscription_start_date', 'subscription_start_date__first_contract_',
      ],
      filterGroups: [{
        filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }],
      }],
    })

    if (companies.length === 0) {
      return NextResponse.json({ clients: [], csmOwnerIds: [] })
    }

    // ── 2. Contracts pipeline deals (search directly — avoids loading all 3000+ deals) ──
    const dealPropsMap: Record<string, Record<string, string>> = {}
    const contractDealsRaw = await searchAll('/crm/v3/objects/deals/search', {
      limit: 100,
      properties: [
        'dealname', 'dealstage', 'pipeline', 'amount', 'hs_acv', 'hs_arr',
        'auto_renewal', 'subscription_end_date', 'pause_end_date',
        'churn_date', 'communicated_churn_date', 'reason_for_churn', 'closedate',
        'hubspot_owner_id', 'notes_last_contacted', 'createdate',
      ],
      filterGroups: [{
        filters: [{ propertyName: 'pipeline', operator: 'EQ', value: CONTRACTS_PIPELINE }],
      }],
    })
    for (const d of contractDealsRaw) {
      dealPropsMap[String(d.id)] = (d.properties as Record<string, string>) ?? {}
    }

    // ── 3. Associate contract deals → companies (chunked, 100/request) ───────
    const contractDealIds = Object.keys(dealPropsMap)
    const coDealIds: Record<string, string[]> = {}
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
            coDealIds[coId] = [...(coDealIds[coId] ?? []), dealId]
          }
        }
      }
    }

    // ── 4. Onboarding deals ───────────────────────────────────────────────────
    const obDeals = await searchAll('/crm/v3/objects/deals/search', {
      limit: 100,
      properties: ['dealstage', 'createdate'],
      filterGroups: [{
        filters: [
          { propertyName: 'pipeline',  operator: 'EQ',  value: ONBOARDING_PIPELINE },
          { propertyName: 'dealstage', operator: 'NEQ', value: '124085903' }, // exclude Fully Onboarded
        ],
      }],
    })

    const obCoMap: Record<string, { active: boolean; days: number; stage: string | null }> = {}
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
          const coId  = String(toObj?.toObjectId ?? toObj?.id ?? '')
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

    // ── 5. Build Client objects ───────────────────────────────────────────────
    const clients: Client[] = companies.flatMap(co => {
      const cp   = (co.properties as Record<string, string>) ?? {}
      const coId = String(co.id)
      const name = cp.name?.trim() || cp.domain?.trim() || null
      if (!name) return []

      // Best contract deal: highest ARR, excluding churned/not-started stages
      const dealIds = coDealIds[coId] ?? []
      const contractDeals = dealIds
        .map(id => ({ id, props: dealPropsMap[id] }))
        .filter(d => d.props && !EXCLUDED_STAGES.has(d.props.dealstage ?? ''))
        .sort((a, b) =>
          parseFloat(b.props.hs_arr || b.props.hs_acv || b.props.amount || '0') -
          parseFloat(a.props.hs_arr || a.props.hs_acv || a.props.amount || '0'))

      if (contractDeals.length === 0) return []

      const bestDeal = contractDeals[0]
      const deal     = bestDeal.props
      const dealId   = bestDeal.id

      // CSM: deal owner (hubspot_owner_id is always a numeric ID)
      const csmOwnerId = String(deal.hubspot_owner_id ?? '').trim()
      const csm: CSMName = ownerName(csmOwnerId)

      const stage               = deal.dealstage ?? ''
      const autoRenewal         = deal.auto_renewal === 'true'
      const subscriptionEndDate = deal.subscription_end_date?.split('T')[0] ?? deal.closedate?.split('T')[0] ?? null
      const pauseEndDate        = deal.pause_end_date?.split('T')[0] ?? null
      const churnDate           = deal.churn_date?.split('T')[0] ?? null

      // Last contact: most recent across deal + company fields
      const dealContactMs     = deal.notes_last_contacted ? new Date(deal.notes_last_contacted).getTime() : NaN
      const companyContactMs  = cp.notes_last_contacted   ? new Date(cp.notes_last_contacted).getTime()   : NaN
      const companyActivityMs = cp.hs_last_activity_date  ? new Date(cp.hs_last_activity_date).getTime()  : NaN
      const contactCandidates = [dealContactMs, companyContactMs, companyActivityMs].filter(t => !isNaN(t))
      const lastContactedMs   = contactCandidates.length > 0 ? Math.max(...contactCandidates) : NaN
      const lastDays          = !isNaN(lastContactedMs)
        ? Math.max(0, Math.floor((Date.now() - lastContactedMs) / 86400000))
        : 999

      const serviceLevel = cp.client_success_service_level as 'High' | 'Medium' | 'Low' | null ?? null
      const churnFlag    = cp.churn_risk === 'true'
      const ob           = obCoMap[coId] ?? { active: false, days: 0, stage: null }

      const arr = parseFloat(
        deal.hs_arr || deal.hs_acv || deal.amount ||
        cp.total_contract_value || cp.annualrevenue || '0'
      ) || 0

      const contractStart = deal.createdate?.split('T')[0]
        ?? cp.subscription_start_date
        ?? cp['subscription_start_date__first_contract_']
        ?? null

      const { state, rules } = classify(
        stage, autoRenewal, subscriptionEndDate, pauseEndDate, churnDate,
        lastDays, serviceLevel, churnFlag, ob.active, ob.days,
      )
      const score = toScore(state, lastDays)

      // Score drivers
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
            usageHealth: null,
            churnRisk: churnFlag,
            npsStatus: cp.nps_status ?? null,
            totalActiveFlows: 0,
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
        hubspotDealUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${dealId}`,
      } as Client]
    })

    // Sort: churn → action → keep_an_eye → stable, then by ARR desc
    const order: Record<HealthState, number> = { churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3 }
    clients.sort((a, b) => {
      if (order[a.healthState] !== order[b.healthState]) return order[a.healthState] - order[b.healthState]
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
      .map(([id]) => ({ name: ownerName(id), ownerId: id }))

    return NextResponse.json({ clients, csmOwnerIds })

  } catch (err) {
    console.error('HubSpot companies route error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
