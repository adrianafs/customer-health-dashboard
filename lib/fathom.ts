import Anthropic from '@anthropic-ai/sdk'

const FATHOM_BASE = 'https://api.fathom.ai/external/v1'
const FATHOM_KEY = process.env.FATHOM_API_KEY

function fathomHeaders() {
  return { 'X-Api-Key': FATHOM_KEY ?? '', 'Content-Type': 'application/json' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FathomActionItem {
  text: string
  assignee_email?: string
  completed?: boolean
}

export interface FathomAttendee {
  email?: string
  name?: string
}

export interface FathomCrmMatch {
  type: 'company' | 'contact' | 'deal'
  id: string
  name?: string
}

export interface FathomMeeting {
  id: string
  title: string
  url: string
  share_url?: string
  created_at: string
  recording_start_time?: string
  default_summary?: string
  action_items?: FathomActionItem[]
  calendar_invitees?: FathomAttendee[]
  recorded_by?: FathomAttendee[]
  crm_matches?: FathomCrmMatch[]
}

export interface FathomCompanyResult {
  meetings: FathomMeeting[]
  sentiment: string | null
  sentimentType: 'positive' | 'negative' | 'neutral' | 'churn' | null
  lastCallDate: string | null
  callCount: number
  openActionItems: number
  openActionItemsForCsm: FathomActionItem[]
}

// ─── 1. Fetch meetings (last 90 days, paginated) ──────────────────────────────

export async function fetchMeetings(): Promise<FathomMeeting[]> {
  if (!FATHOM_KEY) return []

  const since = new Date()
  since.setDate(since.getDate() - 90)
  const createdAfter = since.toISOString()

  const meetings: FathomMeeting[] = []
  let cursor: string | undefined

  do {
    const params = new URLSearchParams({ created_after: createdAfter, limit: '50' })
    if (cursor) params.set('cursor', cursor)

    const res = await fetch(`${FATHOM_BASE}/meetings?${params}`, {
      headers: fathomHeaders(),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error('Fathom API error:', res.status, await res.text())
      break
    }

    const data = await res.json()
    meetings.push(...(data.data ?? data.meetings ?? data.results ?? []))
    cursor = data.next_cursor ?? data.cursor ?? undefined
  } while (cursor)

  return meetings
}

// ─── 2. Match meetings to a company ──────────────────────────────────────────

export function matchMeetingsToCompany(
  meetings: FathomMeeting[],
  companyName: string,
  companyId: string,
  knownEmails: string[] = [],
): FathomMeeting[] {
  const nameLower = companyName.toLowerCase()

  // Derive possible domains from company name (e.g. "Bestseller" → "bestseller.com")
  const nameDomain = nameLower.replace(/[^a-z0-9]/g, '') + '.com'

  return meetings.filter(m => {
    // Strategy 1 — CRM match (Fathom already linked to this HubSpot company)
    if (m.crm_matches?.some(c => c.type === 'company' && c.id === companyId)) return true

    // Strategy 2 — Domain match (attendee email contains company domain)
    const allEmails = [
      ...(m.calendar_invitees ?? []).map(a => a.email ?? ''),
      ...(m.recorded_by ?? []).map(a => a.email ?? ''),
    ].map(e => e.toLowerCase())

    if (allEmails.some(e => e.includes('@' + nameDomain) || e.includes('@' + nameLower.replace(/\s+/g, '')))) return true

    // Strategy 3 — Known contact emails
    if (knownEmails.length > 0 && allEmails.some(e => knownEmails.includes(e))) return true

    // Strategy 4 — Title match (meeting title contains company name)
    if (m.title?.toLowerCase().includes(nameLower)) return true

    return false
  })
}

// ─── 3. Analyse sentiment with Claude ────────────────────────────────────────

export async function analyseSentiment(
  meetings: FathomMeeting[],
  companyName: string,
): Promise<{ sentence: string; type: 'positive' | 'negative' | 'neutral' | 'churn' }> {
  const summaries = meetings
    .filter(m => m.default_summary)
    .slice(0, 3)
    .map((m, i) => `Call ${i + 1} (${m.created_at?.split('T')[0]}): ${m.default_summary}`)
    .join('\n\n')

  if (!summaries) {
    return { sentence: 'No call summaries available', type: 'neutral' }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 150,
    system: `You are a Customer Success analyst. Based on call summaries, write ONE concise sentence (max 20 words) that captures the most important signal about this customer's health and sentiment.

Then classify it as: positive, negative, neutral, or churn (churn = explicit risk signals like cancellation intent, competitor evaluation, ROI concerns).

Return ONLY valid JSON: {"sentence": "...", "type": "positive"|"negative"|"neutral"|"churn"}`,
    messages: [{
      role: 'user',
      content: `Company: ${companyName}\n\nRecent call summaries:\n${summaries}`,
    }],
  })

  try {
    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim())
    return { sentence: parsed.sentence, type: parsed.type ?? 'neutral' }
  } catch {
    return { sentence: 'Unable to analyse sentiment', type: 'neutral' }
  }
}

// ─── Main: get all Fathom data for a company ─────────────────────────────────

export async function getFathomDataForCompany(
  companyName: string,
  companyId: string,
  csmEmail?: string,
): Promise<FathomCompanyResult> {
  try {
    const allMeetings = await fetchMeetings()
    const matched = matchMeetingsToCompany(allMeetings, companyName, companyId)

    if (matched.length === 0) {
      return { meetings: [], sentiment: null, sentimentType: null, lastCallDate: null, callCount: 0, openActionItems: 0, openActionItemsForCsm: [] }
    }

    // Sort by date descending
    matched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    const lastCallDate = matched[0]?.created_at?.split('T')[0] ?? null
    const callCount = matched.length

    // Collect open action items
    const allActionItems = matched.flatMap(m => m.action_items ?? [])
    const openItems = allActionItems.filter(a => !a.completed)
    const openForCsm = csmEmail
      ? openItems.filter(a => a.assignee_email?.toLowerCase() === csmEmail.toLowerCase())
      : openItems

    // Analyse sentiment
    const { sentence, type } = await analyseSentiment(matched, companyName)

    return {
      meetings: matched.slice(0, 5),
      sentiment: sentence,
      sentimentType: type,
      lastCallDate,
      callCount,
      openActionItems: openItems.length,
      openActionItemsForCsm: openForCsm,
    }
  } catch (err) {
    console.error('Fathom integration error:', err)
    return { meetings: [], sentiment: null, sentimentType: null, lastCallDate: null, callCount: 0, openActionItems: 0, openActionItemsForCsm: [] }
  }
}
