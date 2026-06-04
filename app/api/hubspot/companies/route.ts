export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { Client, HealthState, CSMName, DEAL_STAGE_LABELS } from '@/lib/types'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

// ─── Pipeline IDs (portal 8988558, confirmed via /api/hubspot/diagnose) ──────
const CONTRACTS_PIPELINE  = '874052773'
const ONBOARDING_PIPELINE = '874052774'

// Onboarding stages = still being onboarded (excludes 1309169026 = Fully Onboarded)
const ONBOARDING_ACTIVE_STAGES = new Set([
  '1309169021', // Onboarding Kick-off
  '1309169022', // Implementation
  '1309169023', // Stuck in Onboarding
  '1309169024', // Client Live
  '1309169025', // Implementation Review Done
])

// Contract stages to exclude from the dashboard entirely
const EXCLUDED_STAGES = new Set([
  '1309169018', // Churned
  '1309169012', // Contract not started
])

// ─── HubSpot portal ID — used for building deal URLs ─────────────────────────
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? '8988558'

// ─── Owner ID → name map ──────────────────────────────────────────────────────
// IDs come from the HubSpot owners API (/crm/v3/owners) — each user gets a
// unique numeric ID visible in their HubSpot profile URL.
// Source file: HubSpot_User_IDs.xlsx
// Keys use the owner "id" from /crm/v3/owners (NOT userId — they differ for some users).
// Where id ≠ userId both values are stored so lookups work regardless of which field
// HubSpot returns on a given object.
const OWNER_NAMES: Record<string, string> = {
  '897219':    'Eulogi Bordas',
  '1596054':   'Ben Heinkel',
  '2762423':   'Sof Michaels',
  '5332601':   'Davy Laudet',
  '7359612':   'Oktawia Gardecka',
  '7587005':   'Jordi Sintes',
  '10527094':  'Sergi Mulero',
  '11386606':  'Emeline Lucas',
  '24704465':  'Derek van Grieken',
  '24985003':  'Cristina Baeza',
  '27040998':  'Louis Theodor',
  '27676528':  'Analicia Montealegre',
  '46571222':  'Frida Lindqvist',
  '46571229':  'Chantal van den Berg',
  '46571243':  'Soufiane El Mardi',
  '47685461':  'David Hansson',
  '50700746':  'Paula Puga Sanz',
  '55136257':  'Mikkel Malesa',       // owner id
  '8640563':   'Mikkel Malesa',       // userId alias
  '59466511':  'Sandra Vinsa',
  '62715576':  'Sophia Garner Rønne',
  '62715596':  'Ola Bortnowska',
  '64994666':  'Claudia Núñez',
  '82166106':  'Claudia Núñez',       // secondary account
  '1918285936':'Claudia Núñez',       // secondary account
  '65666643':  'Laura Marie Ravn',
  '65671669':  'Vinicio Oliveira',
  '66551551':  'Isabel Fugmann',
  '69116560':  'Maja Kjellson',
  '69329949':  'Dennis Schjødt Hansen',
  '69434237':  'Cecile Gautier',
  '70541122':  'Ellisif Bendiksen',
  '71103443':  'Olivia Gonzalez Basanta',
  '71337806':  'Tatiana Lozano',
  '72382253':  'Samuel Wadström',
  '73109042':  'Kristian Frederiksen Pedersen',
  '75827652':  'Sophia Jonsson',
  '76033612':  'Johannes Ipland',
  '76033686':  'Robin Sand',
  '76033697':  'Ørjan Christiansen',
  '78103049':  'Jana Khoraizat',
  '78103070':  'Signe Manniche Larsen',
  '79209473':  'Amin Durani',
  '80974218':  'Nina Brown',
  '81275041':  'Hajo Oldewelt',
  '81375028':  'Amber Williams',
  '81605073':  'David Kupfer',
  '82367576':  'Bruna Schmidt',
  '83251257':  'Jeno Toth',
  '84230949':  'Rasmus Tobiasen',     // owner id
  '25169562':  'Rasmus Tobiasen',     // userId alias
  '85008554':  'Tage Almark',
  '86814062':  'Thibaud Delaunay',
  '87061202':  'Lucia Fuentes',
  '87809160':  'Jean Bouaziz',
  '87957608':  'Elena Garcia Molina',
  '88759156':  'Raghunath Vasireddy',
  '90050587':  'Jerry de Waart',
  '90092479':  'Enric Martínez',
  '90574443':  'Jonas Gebre-Medhin',
  '90574444':  'Oliver Hovstadius',
  '91858010':  'Lawrence Langley',
  '91858011':  'Ollie Ivarsson',
  '91858012':  'Rana Cherkaoui',
  '92933356':  'Johannes Gustafsson',
  '94368932':  'Markus Bergendorff',  // owner id
  '25758215':  'Markus Bergendorff',  // userId alias
  '176918842': 'Mads Wedderkopp',     // owner id
  '44847211':  'Mads Wedderkopp',     // userId alias
  '201223591': 'René Plesner',        // owner id
  '45862700':  'René Plesner',        // userId alias
  '229999459': 'Christina Holm',      // owner id
  '46895807':  'Christina Holm',      // userId alias
  '432010572': 'Michael Kent Christensen', // owner id
  '68615816':  'Michael Kent Christensen', // userId alias
  '503263763': 'Morten Frank',        // owner id
  '59783520':  'Morten Frank',        // userId alias
  '858548871': 'Peter Linné',         // owner id
  '65666661':  'Peter Linné',         // userId alias
  '45190234':  'Roel Hoedemakers',
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
  if (stage === '1309169016') return { state: 'churn_risk', rules: ['communicated_churn_stage'] }

  // ── ACTION REQUIRED ─────────────────────────────────────────────────────────
  if (inOB && obDays > 90 && stage === '1309169022')
    return { state: 'action_required', rules: ['onboarding_implementation_90d'] }
  if (!autoRenewal && daysUntil(subscriptionEndDate) < 100)
    return { state: 'action_required', rules: ['auto_renewal_false_sub_end_100d'] }
  if (stage === '1309169014' && lastDays > 30)
    return { state: 'action_required', rules: ['up_for_renewal_no_contact_30d'] }
  if (stage === '1309169015' && daysUntil(subscriptionEndDate) <= 45)
    return { state: 'action_required', rules: ['renewal_in_progress_sub_end_45d'] }

  // ── KEEP AN EYE ─────────────────────────────────────────────────────────────
  if (inOB)                   return { state: 'keep_an_eye', rules: ['onboarding_active'] }
  if (serviceLevel === 'High' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['high_service_no_contact_45d'] }
  if (stage === '1309169014' && lastDays > 45)
    return { state: 'keep_an_eye', rules: ['up_for_renewal_no_contact_45d'] }
  if (stage === '1309169015') return { state: 'keep_an_eye', rules: ['renewal_in_progress'] }
  if (stage === '1309169017' && daysUntil(pauseEndDate) <= 30)
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
        'hs_parent_company_id',
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
    // Build both directions: deal→companies (all) and company→deals
    const contractDealIds = Object.keys(dealPropsMap)
    const coDealIds: Record<string, string[]> = {}
    const dealCompaniesMap: Record<string, string[]> = {}
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
          const toList = (r.to ?? []) as Record<string, unknown>[]
          for (const toObj of toList) {
            const coId = String(toObj?.toObjectId ?? toObj?.id ?? '')
            if (dealId && coId) {
              coDealIds[coId] = [...(coDealIds[coId] ?? []), dealId]
              dealCompaniesMap[dealId] = [...(dealCompaniesMap[dealId] ?? []), coId]
            }
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
          { propertyName: 'dealstage', operator: 'NEQ', value: '1309169026' }, // exclude Fully Onboarded
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

    // ── 5. Build Client objects — one per deal, using parent company ─────────
    // Index companies by ID for fast lookup
    const companyById: Record<string, Record<string, string>> = {}
    for (const co of companies) {
      companyById[String(co.id)] = (co.properties as Record<string, string>) ?? {}
    }

    const clients: Client[] = Object.entries(dealPropsMap).flatMap(([dealId, deal]) => {
      // Skip excluded stages
      if (EXCLUDED_STAGES.has(deal.dealstage ?? '')) return []

      // All companies associated to this deal
      const assocCoIds = dealCompaniesMap[dealId] ?? []
      if (assocCoIds.length === 0) return []

      // Pick the parent company: prefer the one with no hs_parent_company_id,
      // then the one whose id appears as hs_parent_company_id on siblings,
      // then fall back to the first.
      const childIdSet = new Set(
        assocCoIds.map(id => companyById[id]?.hs_parent_company_id).filter(Boolean)
      )
      const parentCoId =
        assocCoIds.find(id => childIdSet.has(id)) ??
        assocCoIds.find(id => !companyById[id]?.hs_parent_company_id) ??
        assocCoIds[0]

      const cp = companyById[parentCoId]
      if (!cp) return []

      const coId = parentCoId
      const name = cp.name?.trim() || cp.domain?.trim() || null
      if (!name) return []

      // Child company names (all siblings excluding the parent)
      const childCompanies = assocCoIds
        .filter(id => id !== parentCoId && companyById[id])
        .map(id => companyById[id].name?.trim() || companyById[id].domain?.trim() || '')
        .filter(Boolean)

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

      const contractStart = cp.subscription_start_date
        ?? cp['subscription_start_date__first_contract_']
        ?? deal.createdate?.split('T')[0]
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
      if (stage === '1309169016')
        drivers.push({ label: 'Communicated churn', type: 'critical', direction: 'declining' })
      if (stage === '1309169017')
        drivers.push({ label: pauseEndDate ? `Paused — resumes ${pauseEndDate}` : 'Paused', type: 'neutral', direction: 'stable' })
      if (stage === '1309169019')
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
        ...(childCompanies.length > 0 ? { childCompanies } : {}),
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
