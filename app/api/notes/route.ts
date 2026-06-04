/**
 * POST /api/notes       — save a note to HubSpot as an engagement
 * GET  /api/notes?companyId=XXX — fetch recent notes for a company
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

// ── Save a note ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' }, { status: 503 })

  const { companyId, dealId, note, csmName } = await req.json() as {
    companyId: string
    dealId?: string
    note: string
    csmName: string
  }

  if (!companyId || !note?.trim()) {
    return NextResponse.json({ error: 'companyId and note are required' }, { status: 400 })
  }

  // Create a HubSpot note engagement
  const body = {
    engagement: {
      active: true,
      type: 'NOTE',
      timestamp: Date.now(),
    },
    associations: {
      companyIds: [parseInt(companyId, 10)],
      dealIds: dealId ? [parseInt(dealId, 10)] : [],
      contactIds: [],
      ownerIds: [],
    },
    metadata: {
      body: `[${csmName} via CS Dashboard]\n\n${note.trim()}`,
    },
  }

  const res = await fetch(`${HS}/crm/v1/engagements`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[notes] HubSpot error:', err)
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({ success: true, engagementId: data.engagement?.id })
}

// ── Fetch recent notes ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ notes: [] })

  const companyId = req.nextUrl.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

  // Get engagements associated to this company
  const res = await fetch(
    `${HS}/crm/v1/engagements/associated/COMPANY/${companyId}/paged?limit=20`,
    { headers: auth() }
  )

  if (!res.ok) return NextResponse.json({ notes: [] })

  const data = await res.json()
  const results = data.results ?? []

  // Filter to NOTE type only, sort newest first
  const notes = results
    .filter((e: any) => e.engagement?.type === 'NOTE')
    .sort((a: any, b: any) => (b.engagement?.timestamp ?? 0) - (a.engagement?.timestamp ?? 0))
    .slice(0, 10)
    .map((e: any) => ({
      id: e.engagement?.id,
      body: e.metadata?.body ?? '',
      timestamp: e.engagement?.timestamp,
      date: e.engagement?.timestamp
        ? new Date(e.engagement.timestamp).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
          })
        : null,
    }))

  return NextResponse.json({ notes })
}
