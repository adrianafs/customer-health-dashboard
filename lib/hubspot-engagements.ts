import Anthropic from '@anthropic-ai/sdk'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Types ────────────────────────────────────────────────────────────────────

export type EngagementType = 'EMAIL' | 'CALL' | 'MEETING' | 'NOTE'

export interface HubSpotEngagement {
  id: string
  type: EngagementType
  timestamp: string
  subject?: string
  body?: string
  direction?: 'INBOUND' | 'OUTBOUND'
}

export type ChurnSignalKey =
  | 'economic'        // budget cuts, too expensive, no clear ROI, "nice to have"
  | 'resources'       // no time, no one managing the platform
  | 'stakeholder'     // champion leaving, unclear replacement, new boss doesn't know Flowbox
  | 'product'         // not what they expected, technical issues, integration problems
  | 'competitor'      // explicitly mentions a competitor
  | 'strategy'        // pivoting away from UGC / influencer marketing
  | 'content'         // not enough UGC content being collected, disappointed with supply

export interface ChurnSignal {
  key: ChurnSignalKey
  detected: boolean
  evidence: string | null   // short quote or reason from the activity
}

export interface EngagementResult {
  engagements: HubSpotEngagement[]
  sentiment: string | null
  sentimentType: 'positive' | 'negative' | 'neutral' | 'churn' | null
  lastActivityDate: string | null
  activityCount: number
  openActionItems: string[]
  churnSignals: ChurnSignal[]
}

// ─── Fetch activity IDs for a company via associations v4 ─────────────────────

async function getActivityIds(companyId: string, type: string): Promise<string[]> {
  const res = await fetch(`${HS}/crm/v4/associations/company/${type}/batch/read`, {
    method: 'POST',
    headers: auth(),
    cache: 'no-store',
    body: JSON.stringify({ inputs: [{ id: companyId }] }),
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.results?.[0]?.to ?? [])
    .map((t: Record<string, unknown>) => String(t.toObjectId ?? t.id ?? ''))
    .filter(Boolean)
}

// ─── Batch read activity objects ──────────────────────────────────────────────

const PROPS: Record<string, string[]> = {
  notes:    ['hs_note_body', 'hs_timestamp'],
  emails:   ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_timestamp'],
  meetings: ['hs_meeting_title', 'hs_meeting_body', 'hs_timestamp'],
  calls:    ['hs_call_title', 'hs_call_body', 'hs_timestamp'],
}

async function batchReadActivities(
  type: string,
  ids: string[],
): Promise<Record<string, string>[]> {
  if (ids.length === 0) return []
  const results: Record<string, string>[] = []

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    await sleep(200)
    const res = await fetch(`${HS}/crm/v3/objects/${type}/batch/read`, {
      method: 'POST',
      headers: auth(),
      cache: 'no-store',
      body: JSON.stringify({
        inputs: chunk.map(id => ({ id })),
        properties: PROPS[type] ?? [],
      }),
    })
    if (!res.ok) continue
    const data = await res.json()
    for (const obj of data.results ?? []) {
      results.push({ id: String(obj.id), ...obj.properties })
    }
  }

  return results
}

// ─── Fetch all engagements for a company (last 90 days) ───────────────────────

export async function fetchEngagements(companyId: string): Promise<HubSpotEngagement[]> {
  if (!TOKEN) return []

  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000
  const engagements: HubSpotEngagement[] = []

  const types = ['notes', 'emails', 'meetings', 'calls'] as const

  for (const type of types) {
    const ids = await getActivityIds(companyId, type)
    if (ids.length === 0) continue

    const objects = await batchReadActivities(type, ids)

    for (const obj of objects) {
      const ts = obj.hs_timestamp ? new Date(obj.hs_timestamp).getTime() : 0
      // Skip future-dated records and records older than 6 months
      if (ts > Date.now() || ts < cutoff) continue

      let subject: string | undefined
      let body: string | undefined
      let direction: 'INBOUND' | 'OUTBOUND' | undefined

      if (type === 'notes') {
        body = obj.hs_note_body ? stripHtml(obj.hs_note_body) : undefined
      } else if (type === 'emails') {
        subject = obj.hs_email_subject || undefined
        body    = obj.hs_email_text    || undefined
        direction = (obj.hs_email_direction === 'INCOMING_EMAIL' || obj.hs_email_direction === 'FORWARDED_EMAIL')
          ? 'INBOUND' : 'OUTBOUND'
      } else if (type === 'meetings') {
        subject = obj.hs_meeting_title || undefined
        body    = obj.hs_meeting_body  || undefined
      } else if (type === 'calls') {
        subject = obj.hs_call_title || undefined
        body    = obj.hs_call_body  || undefined
      }

      if (!subject && !body) continue

      engagements.push({
        id: obj.id,
        type: ({ notes: 'NOTE', emails: 'EMAIL', meetings: 'MEETING', calls: 'CALL' } as const)[type],
        timestamp: obj.hs_timestamp ?? new Date(ts).toISOString(),
        subject,
        body: body ? truncate(body, 600) : undefined,
        direction,
      })
    }
  }

  // Sort newest first
  engagements.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return engagements
}

// ─── Claude sentiment analysis ────────────────────────────────────────────────

export async function analyseEngagements(
  engagements: HubSpotEngagement[],
  companyName: string,
): Promise<{ sentiment: string; sentimentType: 'positive' | 'negative' | 'neutral' | 'churn'; openActionItems: string[]; churnSignals: ChurnSignal[] }> {
  const emptySignals: ChurnSignal[] = (
    ['economic', 'resources', 'stakeholder', 'product', 'competitor', 'strategy', 'content'] as ChurnSignalKey[]
  ).map(key => ({ key, detected: false, evidence: null }))

  if (engagements.length === 0) {
    return { sentiment: 'No recent activity found', sentimentType: 'neutral', openActionItems: [], churnSignals: emptySignals }
  }

  const lines = engagements.slice(0, 15).map(e => {
    const date  = e.timestamp.split('T')[0]
    const label = `[${e.type}${e.direction ? ` ${e.direction}` : ''} — ${date}]`
    const text  = [e.subject, e.body].filter(Boolean).join(' | ').slice(0, 500)
    return `${label} ${text}`
  }).join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 600,
    system: `You are a Customer Success analyst for Flowbox, a UGC and influencer marketing SaaS. You receive recent CRM activity (emails, calls, meetings, notes) for a customer. Content may be in any language — always respond in English.

Return ONLY valid JSON with this exact structure:
{
  "sentiment": "<one sentence, max 20 words, most important health signal>",
  "sentimentType": "positive" | "negative" | "neutral" | "churn",
  "openActionItems": ["<action 1>"],
  "churnSignals": {
    "economic":    { "detected": true|false, "evidence": "<short quote or null>" },
    "resources":   { "detected": true|false, "evidence": "<short quote or null>" },
    "stakeholder": { "detected": true|false, "evidence": "<short quote or null>" },
    "product":     { "detected": true|false, "evidence": "<short quote or null>" },
    "competitor":  { "detected": true|false, "evidence": "<short quote or null>" },
    "strategy":    { "detected": true|false, "evidence": "<short quote or null>" },
    "content":     { "detected": true|false, "evidence": "<short quote or null>" }
  }
}

CHURN SIGNAL DEFINITIONS — apply a very high bar. Only mark detected:true if there is explicit, unambiguous evidence in the text. When in doubt, mark false.

- economic: Client explicitly mentions budget cuts, says Flowbox is too expensive, questions ROI with clear intent to reconsider the contract, or treats it as a "nice to have" they could drop. Vague mentions of cost or budget without renewal intent do NOT count.

- resources: Client has explicitly stated they do not have time for Flowbox AND this is framed as a reason to reconsider the contract renewal. General busyness, slow replies, or "we've been busy" do NOT count — only explicit statements linking lack of time/resources to contract risk.

- stakeholder: Client has explicitly stated there is no one dedicated to Flowbox, that team restructuring means nobody will manage it, or a new decision-maker has expressed clear doubt about keeping the contract. A contact leaving the company alone does NOT count — there must be explicit uncertainty about who takes over OR a new stakeholder questioning the value.

- product: Client has expressed strong dissatisfaction with the product due to: (a) major technical issues or bugs that are blockers to using the platform, (b) platform instability mentioned multiple times, or (c) explicit statement that the sales process oversold features that don't exist. Minor bugs, feature requests, or general feedback do NOT count — the issues must be blocking their use of Flowbox.

- competitor: Client explicitly names a direct Flowbox competitor AND the context is evaluating or replacing Flowbox with it. Direct competitors only: Bazaarvoice, Join Stories, Taggbox, Squarelovin, Cevoid, Emplifi, Stackla, Yotpo, Skeepers, Club.co, Modash, Influencity, Kolsquare, Stellar.io. If the competitor is mentioned as something they tried in the past, use for a different purpose, or just heard about — do NOT mark as detected.

- strategy: Client has explicitly stated they are stopping influencer/creator collaborations or UGC collection entirely and reallocating that budget to other channels. General shifts in marketing focus or reducing investment do NOT count — must be an explicit statement of abandoning this strategy.

- content: Client has expressed clear frustration that they are not receiving enough UGC content (in quantity or quality), has tried strategies to generate more that failed, and this is framed as a fundamental blocker — not just a temporary challenge. General disappointment or wanting more content does NOT count — must be explicit frustration with no path forward.

sentimentType:
- "churn": cancellation intent, strong dissatisfaction, competitor evaluation, ROI doubts
- "negative": complaints, frustration, unresolved issues, low engagement
- "positive": satisfaction, growth signals, active usage, renewal intent
- "neutral": routine check-ins, no strong signals

openActionItems: CSM promises or follow-ups with no evidence of resolution. Max 3, empty array if none.`,
    messages: [{
      role: 'user',
      content: `Company: ${companyName}\n\nRecent activity from the last 6 months (newest first):\n\n${lines}`,
    }],
  })

  try {
    const text   = response.content.find(b => b.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim())

    const churnSignals: ChurnSignal[] = (
      ['economic', 'resources', 'stakeholder', 'product', 'competitor', 'strategy', 'content'] as ChurnSignalKey[]
    ).map(key => ({
      key,
      detected: parsed.churnSignals?.[key]?.detected === true,
      evidence: parsed.churnSignals?.[key]?.evidence ?? null,
    }))

    return {
      sentiment:       parsed.sentiment       ?? 'Unable to analyse',
      sentimentType:   parsed.sentimentType   ?? 'neutral',
      openActionItems: Array.isArray(parsed.openActionItems) ? parsed.openActionItems.slice(0, 3) : [],
      churnSignals,
    }
  } catch {
    return { sentiment: 'Unable to analyse activity', sentimentType: 'neutral', openActionItems: [], churnSignals: emptySignals }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getEngagementDataForCompany(
  companyId: string,
  companyName: string,
): Promise<EngagementResult> {
  try {
    const engagements = await fetchEngagements(companyId)

    if (engagements.length === 0) {
      return { engagements: [], sentiment: null, sentimentType: null, lastActivityDate: null, activityCount: 0, openActionItems: [], churnSignals: (['economic', 'resources', 'stakeholder', 'product', 'competitor', 'strategy', 'content'] as const).map(key => ({ key, detected: false, evidence: null })) }
    }

    const lastActivityDate = engagements[0]?.timestamp?.split('T')[0] ?? null
    const { sentiment, sentimentType, openActionItems, churnSignals } = await analyseEngagements(engagements, companyName)

    return {
      engagements: engagements.slice(0, 10),
      sentiment,
      sentimentType,
      lastActivityDate,
      activityCount: engagements.length,
      openActionItems,
      churnSignals,
    }
  } catch (err) {
    console.error('HubSpot engagements error:', err)
    const emptySignals = (['economic','resources','stakeholder','product','competitor','strategy','content'] as ChurnSignalKey[]).map(key => ({ key, detected: false, evidence: null }))
    return { engagements: [], sentiment: null, sentimentType: null, lastActivityDate: null, activityCount: 0, openActionItems: [], churnSignals: emptySignals }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}
