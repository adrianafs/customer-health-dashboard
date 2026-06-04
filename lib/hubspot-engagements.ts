import Anthropic from '@anthropic-ai/sdk'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type EngagementType = 'EMAIL' | 'CALL' | 'MEETING' | 'NOTE'

export interface HubSpotEngagement {
  id: string
  type: EngagementType
  timestamp: string   // ISO date
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

// ─── Fetch engagements for a company (last 90 days) ──────────────────────────

export async function fetchEngagements(companyId: string): Promise<HubSpotEngagement[]> {
  if (!TOKEN) return []

  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const engagements: HubSpotEngagement[] = []
  let offset: number | undefined

  do {
    const url = `${HS}/engagements/v1/engagements/associated/COMPANY/${companyId}/paged?limit=100${offset ? `&offset=${offset}` : ''}`
    const res = await fetch(url, { headers: auth(), cache: 'no-store' })
    if (!res.ok) {
      console.error('Engagements API error:', res.status, await res.text())
      break
    }
    const data = await res.json()
    const results = data.results ?? []

    for (const item of results) {
      const eng = item.engagement ?? {}
      const meta = item.metadata ?? {}
      const ts = eng.timestamp ?? eng.createdAt ?? 0

      // Stop if older than 90 days
      if (ts < cutoff) {
        return engagements
      }

      const type: EngagementType = eng.type
      if (!['EMAIL', 'CALL', 'MEETING', 'NOTE'].includes(type)) continue

      // Extract meaningful text based on type
      let subject: string | undefined
      let body: string | undefined
      let direction: 'INBOUND' | 'OUTBOUND' | undefined

      if (type === 'EMAIL') {
        subject = meta.subject ?? undefined
        // Use plain text if available, strip HTML otherwise
        body = meta.text
          ?? (meta.html ? stripHtml(meta.html) : undefined)
          ?? undefined
        direction = meta.direction ?? undefined
      } else if (type === 'NOTE') {
        body = meta.body ?? undefined
      } else if (type === 'MEETING') {
        subject = meta.title ?? undefined
        body = meta.body ?? undefined
      } else if (type === 'CALL') {
        body = meta.body ?? undefined
        direction = meta.disposition === 'INBOUND' ? 'INBOUND' : 'OUTBOUND'
      }

      // Skip empty engagements
      if (!subject && !body) continue

      engagements.push({
        id: String(eng.id),
        type,
        timestamp: new Date(ts).toISOString(),
        subject,
        body: body ? truncate(body, 800) : undefined,
        direction,
      })
    }

    offset = data.hasMore ? data.offset : undefined
  } while (offset && engagements.length < 200)

  return engagements
}

// ─── Analyse with Claude ──────────────────────────────────────────────────────

export async function analyseEngagements(
  engagements: HubSpotEngagement[],
  companyName: string,
): Promise<{ sentiment: string; sentimentType: 'positive' | 'negative' | 'neutral' | 'churn'; openActionItems: string[] }> {
  if (engagements.length === 0) {
    return { sentiment: 'No recent activity found', sentimentType: 'neutral', openActionItems: [] }
  }

  const lines = engagements.slice(0, 10).map(e => {
    const date = e.timestamp.split('T')[0]
    const label = `[${e.type}${e.direction ? ` ${e.direction}` : ''} — ${date}]`
    const text = [e.subject, e.body].filter(Boolean).join(' | ').slice(0, 500)
    return `${label} ${text}`
  }).join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 300,
    system: `You are a Customer Success analyst. You will receive recent CRM activity (emails, calls, meetings, notes) for a customer account. Content may be in any language — always respond in English.

Analyse the activity and return ONLY valid JSON with this structure:
{
  "sentiment": "<one concise sentence, max 20 words, capturing the most important customer health signal>",
  "sentimentType": "positive" | "negative" | "neutral" | "churn",
  "openActionItems": ["<action item 1>", "<action item 2>"]
}

sentimentType rules:
- "churn": cancellation intent, competitor evaluation, strong dissatisfaction, ROI concerns
- "negative": complaints, frustration, unresolved issues, no engagement
- "positive": satisfaction, growth signals, active usage, renewal intent
- "neutral": routine check-ins, no strong signals

openActionItems: CSM promises or follow-ups mentioned that show no evidence of resolution (max 3).`,
    messages: [{
      role: 'user',
      content: `Company: ${companyName}\n\nRecent activity (newest first):\n\n${lines}`,
    }],
  })

  try {
    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim())
    return {
      sentiment: parsed.sentiment ?? 'Unable to analyse',
      sentimentType: parsed.sentimentType ?? 'neutral',
      openActionItems: Array.isArray(parsed.openActionItems) ? parsed.openActionItems.slice(0, 3) : [],
    }
  } catch {
    return { sentiment: 'Unable to analyse activity', sentimentType: 'neutral', openActionItems: [] }
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function getEngagementDataForCompany(
  companyId: string,
  companyName: string,
): Promise<EngagementResult> {
  try {
    const engagements = await fetchEngagements(companyId)

    if (engagements.length === 0) {
      return {
        engagements: [],
        sentiment: null,
        sentimentType: null,
        lastActivityDate: null,
        activityCount: 0,
        openActionItems: [],
      }
    }

    // Sort newest first
    engagements.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

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
    return {
      engagements: [],
      sentiment: null,
      sentimentType: null,
      lastActivityDate: null,
      activityCount: 0,
      openActionItems: [],
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}
