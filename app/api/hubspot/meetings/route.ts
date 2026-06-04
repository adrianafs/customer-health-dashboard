export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function hsPost(path: string, body: object): Promise<Response> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${HS}${path}`, {
      method: 'POST', headers: auth(), cache: 'no-store', body: JSON.stringify(body),
    })
    if (res.status !== 429) return res
    await sleep(1400 * (i + 1))
  }
  return fetch(`${HS}${path}`, { method: 'POST', headers: auth(), cache: 'no-store', body: JSON.stringify(body) })
}

export type HubSpotMeeting = {
  id: string
  title: string | null
  date: string       // ISO date string
  status: string     // COMPLETED, SCHEDULED, NO_SHOW, CANCELLED, etc.
  outcome: string | null
}

export type MeetingsResult = {
  lastMeeting: HubSpotMeeting | null
  nextMeeting: HubSpotMeeting | null
}

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ error: 'missing companyId' }, { status: 400 })
  if (!TOKEN)     return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  try {
    // 1. Get meeting IDs associated to the company
    const assocRes = await hsPost('/crm/v4/associations/company/meetings/batch/read', {
      inputs: [{ id: companyId }],
    })
    if (!assocRes.ok) return NextResponse.json({ lastMeeting: null, nextMeeting: null })

    const assocData = await assocRes.json()
    const meetingIds: string[] = (assocData.results?.[0]?.to ?? [])
      .map((t: Record<string, unknown>) => String(t.toObjectId ?? t.id ?? ''))
      .filter(Boolean)

    if (meetingIds.length === 0) return NextResponse.json({ lastMeeting: null, nextMeeting: null })

    // 2. Fetch meeting details in batch (max 100)
    const batchRes = await fetch(`${HS}/crm/v3/objects/meetings/batch/read`, {
      method: 'POST',
      headers: auth(),
      cache: 'no-store',
      body: JSON.stringify({
        properties: ['hs_meeting_title', 'hs_timestamp', 'hs_meeting_outcome', 'hs_internal_meeting_notes'],
        inputs: meetingIds.slice(0, 100).map(id => ({ id })),
      }),
    })
    if (!batchRes.ok) return NextResponse.json({ lastMeeting: null, nextMeeting: null })

    const batchData = await batchRes.json()
    const now = Date.now()

    const meetings: HubSpotMeeting[] = (batchData.results ?? [])
      .map((m: Record<string, unknown>) => {
        const props = (m.properties ?? {}) as Record<string, string>
        const ts = props.hs_timestamp
        return {
          id: String(m.id ?? ''),
          title: props.hs_meeting_title || null,
          date: ts ? new Date(ts).toISOString().split('T')[0] : '',
          status: props.hs_meeting_outcome ?? 'SCHEDULED',
          outcome: props.hs_meeting_outcome || null,
        }
      })
      .filter((m: HubSpotMeeting) => m.date)
      .sort((a: HubSpotMeeting, b: HubSpotMeeting) => a.date.localeCompare(b.date))

    const past   = meetings.filter(m => new Date(m.date).getTime() <= now)
    const future = meetings.filter(m => new Date(m.date).getTime() >  now)

    const lastMeeting = past.length   > 0 ? past[past.length - 1]   : null
    const nextMeeting = future.length > 0 ? future[0]               : null

    return NextResponse.json({ lastMeeting, nextMeeting } satisfies MeetingsResult)
  } catch (err) {
    console.error('meetings route error:', err)
    return NextResponse.json({ lastMeeting: null, nextMeeting: null })
  }
}
