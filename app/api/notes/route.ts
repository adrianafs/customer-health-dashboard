/**
 * POST /api/notes       — save a note to HubSpot (v3 notes object)
 * GET  /api/notes?companyId=XXX — fetch recent notes for a company
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

// HubSpot-defined association type IDs for the v3 notes object
const NOTE_TO_COMPANY = 190
const NOTE_TO_DEAL    = 214

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

  // Create a HubSpot note via the v3 CRM objects API
  const associations = [
    {
      to: { id: companyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_COMPANY }],
    },
  ]
  if (dealId && dealId !== companyId) {
    associations.push({
      to: { id: dealId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_DEAL }],
    })
  }

  const body = {
    properties: {
      hs_note_body: `[${csmName} via CS Dashboard]\n\n${note.trim()}`,
      hs_timestamp: Date.now(),
    },
    associations,
  }

  const res = await fetch(`${HS}/crm/v3/objects/notes`, {
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
  return NextResponse.json({ success: true, engagementId: data.id })
}

// ── Fetch recent notes ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ notes: [] })

  const companyId = req.nextUrl.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

  // 1. Get note IDs associated to this company
  const assocRes = await fetch(
    `${HS}/crm/v3/objects/companies/${companyId}/associations/notes?limit=100`,
    { headers: auth() }
  )
  if (!assocRes.ok) return NextResponse.json({ notes: [] })

  const assocData = await assocRes.json()
  const noteIds: string[] = (assocData.results ?? []).map((r: any) => String(r.toObjectId ?? r.id)).filter(Boolean)
  if (noteIds.length === 0) return NextResponse.json({ notes: [] })

  // 2. Batch-read note bodies + timestamps
  const readRes = await fetch(`${HS}/crm/v3/objects/notes/batch/read`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({
      properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'],
      inputs: noteIds.map(id => ({ id })),
    }),
  })
  if (!readRes.ok) return NextResponse.json({ notes: [] })

  const readData = await readRes.json()
  const notes = (readData.results ?? [])
    .map((n: any) => {
      const ts = n.properties?.hs_timestamp ?? n.properties?.hs_createdate
      const ms = ts ? new Date(ts).getTime() : 0
      return {
        id: n.id,
        body: n.properties?.hs_note_body ?? '',
        timestamp: ms,
        date: ms
          ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : null,
      }
    })
    .filter((n: any) => n.body)
    .sort((a: any, b: any) => b.timestamp - a.timestamp)
    .slice(0, 10)

  return NextResponse.json({ notes })
}
