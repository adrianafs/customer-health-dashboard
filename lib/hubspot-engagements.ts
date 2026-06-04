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

export interface EngagementResult {
  engagements: HubSpotEngagement[]
  sentiment: string | null
  sentimentType: 'positive' | 'negative' | 'neutral' | 'churn' | null
  lastActivityDate: string | null
  activityCount: number
  openActionItems: string[]
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

  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const engagements: HubSpotEngagement[] = []

  const types = ['notes', 'emails', 'meetings', 'calls'] as const

  for (const type of types) {
    const ids = await getActivityIds(companyId, type)
    if (ids.length === 0) continue

    const objects = await batchReadActivities(type, ids)

    for (const obj of objects) {
      const ts = obj.hs_timestamp ? new Date(obj.hs_timestamp).getTime() : 0
      if (ts < cutoff) continue

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
): Promise<{ sentiment: string; sentimentType: 'positive' | 'negative' | 'neutral' | 'churn'; openActionItems: string[] }> {
  if (engagements.length === 0) {
    return { sentiment: 'No recent activity found', sentimentType: 'neutral', openActionItems: [] }
  }

  const lines = engagements.slice(0, 12).map(e => {
    const date  = e.timestamp.split('T')[0]
    const label = `[${e.type}${e.direction ? ` ${e.direction}` : ''} — ${date}]`
    const text  = [e.subject, e.body].filter(Boolean).join(' | ').slice(0, 500)
    return `${label} ${text}`
  }).join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 300,
    system: `You are a Customer Success analyst. You receive recent CRM activity (emails, calls, meetings, notes) for a customer. Content may be in any language — always respond in English.

Return ONLY valid JSON:
{
  "sentiment": "<one sentence, max 20 words, most important customer health signal>",
  "sentimentType": "positive" | "negative" | "neutral" | "churn",
  "openActionItems": ["<action 1>", "<action 2>"]
}

sentimentType:
- "churn": cancellation intent, competitor evaluation, strong dissatisfaction, ROI doubts
- "negative": complaints, frustration, unresolved issues, low engagement
- "positive": satisfaction, growth, active usage, renewal intent
- "neutral": routine check-ins, no strong signals

openActionItems: CSM promises or follow-ups with no evidence of resolution. Max 3, empty array if none.`,
    messages: [{
      role: 'user',
      content: `Company: ${companyName}\n\nRecent activity (newest first):\n\n${lines}`,
    }],
  })

  try {
    const text   = response.content.find(b => b.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim())
    return {
      sentiment:       parsed.sentiment       ?? 'Unable to analyse',
      sentimentType:   parsed.sentimentType   ?? 'neutral',
      openActionItems: Array.isArray(parsed.openActionItems) ? parsed.openActionItems.slice(0, 3) : [],
    }
  } catch {
    return { sentiment: 'Unable to analyse activity', sentimentType: 'neutral', openActionItems: [] }
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
      return { engagements: [], sentiment: null, sentimentType: null, lastActivityDate: null, activityCount: 0, openActionItems: [] }
    }

    const lastActivityDate = engagements[0]?.timestamp?.split('T')[0] ?? null
    const { sentiment, sentimentType, openActionItems } = await analyseEngagements(engagements, companyName)

    return {
      engagements: engagements.slice(0, 10),
      sentiment,
      sentimentType,
      lastActivityDate,
      activityCount: engagements.length,
      openActionItems,
    }
  } catch (err) {
    console.error('HubSpot engagements error:', err)
    return { engagements: [], sentiment: null, sentimentType: null, lastActivityDate: null, activityCount: 0, openActionItems: [] }
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
