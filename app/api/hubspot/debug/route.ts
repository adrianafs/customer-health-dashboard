export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Try all pagination approaches
  const r1 = await fetch(`${HS}/crm/v3/owners?limit=100`, { headers: auth(), cache: 'no-store' })
  const d1 = r1.ok ? await r1.json() : { error: await r1.text() }

  return NextResponse.json({
    count: d1.results?.length,
    pagingKeys: Object.keys(d1.paging ?? {}),
    pagingAfter: d1.paging?.next?.after,
    // All raw owner objects (first 20)
    owners: d1.results?.slice(0, 20).map((o: Record<string, unknown>) => ({
      id: o.id,
      userId: o.userId,
      email: o.email,
      firstName: o.firstName,
      lastName: o.lastName,
      archived: o.archived,
    })),
  })
}
