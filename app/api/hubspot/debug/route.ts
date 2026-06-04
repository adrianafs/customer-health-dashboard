export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
const CONTRACTS_PIPELINE = '58017946'

function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Get unique hubspot_owner_id values from Contracts pipeline deals
  const res = await fetch(`${HS}/crm/v3/objects/deals/search`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({
      limit: 100,
      properties: ['hubspot_owner_id', 'dealname'],
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: CONTRACTS_PIPELINE }] }],
    }),
  })
  const data = res.ok ? await res.json() : {}

  const uniqueIds = Array.from(new Set(
    (data.results ?? [])
      .map((d: Record<string, unknown>) => (d.properties as Record<string, string>)?.hubspot_owner_id)
      .filter(Boolean)
  )) as string[]

  // Fetch each owner individually to get their name
  const owners = await Promise.all(
    uniqueIds.map(async id => {
      try {
        const r = await fetch(`${HS}/crm/v3/owners/${id}`, { headers: auth(), cache: 'no-store' })
        if (!r.ok) return { id, error: r.status }
        const o = await r.json()
        return { id, firstName: o.firstName, lastName: o.lastName, email: o.email }
      } catch (e) {
        return { id, error: String(e) }
      }
    })
  )

  return NextResponse.json({
    source: `Deal owners from Contracts pipeline (${CONTRACTS_PIPELINE})`,
    uniqueOwnerIds: uniqueIds.length,
    owners,
  })
}
