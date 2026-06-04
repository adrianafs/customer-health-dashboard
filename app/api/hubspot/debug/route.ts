export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
const CONTRACTS_PIPELINE = '58017946'

function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // 1. Get unique hubspot_owner_id values from Contracts pipeline deals
  const dealsRes = await fetch(`${HS}/crm/v3/objects/deals/search`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({
      limit: 100,
      properties: ['hubspot_owner_id'],
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: CONTRACTS_PIPELINE }] }],
    }),
  })
  const dealsData = dealsRes.ok ? await dealsRes.json() : {}
  const dealOwnerIds = new Set<string>(
    (dealsData.results ?? [])
      .map((d: Record<string, unknown>) => (d.properties as Record<string, string>)?.hubspot_owner_id)
      .filter(Boolean)
  )

  // 2. Fetch all owners from the list endpoint (works with Bearer token)
  const allOwners: Record<string, { firstName: string; lastName: string; email: string }> = {}
  let offset = 0
  let done = false
  while (!done) {
    const r = await fetch(`${HS}/crm/v3/owners?limit=200&offset=${offset}&includeDeactivated=true`, {
      headers: auth(), cache: 'no-store',
    })
    if (!r.ok) break
    const data = await r.json()
    for (const o of data.results ?? []) {
      allOwners[String(o.id)] = { firstName: o.firstName ?? '', lastName: o.lastName ?? '', email: o.email ?? '' }
    }
    if ((data.results ?? []).length < 200) done = true
    else offset += 200
  }

  // 3. Cross-reference: which deal owner IDs are known vs unknown?
  const known: Record<string, unknown>[] = []
  const unknown: string[] = []
  for (const id of dealOwnerIds) {
    if (allOwners[id]) {
      const o = allOwners[id]
      known.push({ id, name: `${o.firstName} ${o.lastName}`.trim(), email: o.email })
    } else {
      unknown.push(id)
    }
  }

  return NextResponse.json({
    source: `Deal owners from Contracts pipeline (${CONTRACTS_PIPELINE})`,
    totalOwnersInHubSpot: Object.keys(allOwners).length,
    dealOwnerIds: dealOwnerIds.size,
    known,
    unknown,
    allOwnersSample: Object.entries(allOwners).slice(0, 5).map(([id, o]) => ({ id, ...o })),
  })
}
