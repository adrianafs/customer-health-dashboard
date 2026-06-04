export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Fetch first page of owners — show raw response to diagnose pagination + fields
  const res = await fetch(`${HS}/crm/v3/owners?limit=100`, { headers: auth(), cache: 'no-store' })
  const data = res.ok ? await res.json() : { error: await res.text() }

  return NextResponse.json({
    total: data.results?.length,
    paging: data.paging,
    // Show ALL fields for first 5 owners so we can see what's available
    sample: data.results?.slice(0, 5).map((o: Record<string, unknown>) => ({
      id: o.id,
      email: o.email,
      firstName: o.firstName,
      lastName: o.lastName,
      userId: o.userId,
      archived: o.archived,
      allFields: Object.keys(o),
    })),
    // Show just id+name for all owners
    all: data.results?.map((o: Record<string, unknown>) => ({
      id: o.id,
      firstName: o.firstName,
      lastName: o.lastName,
      email: o.email,
    })),
  })
}
