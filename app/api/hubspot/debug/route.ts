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
  const dealOwnerIds = Array.from(new Set<string>(
    (dealsData.results ?? [])
      .map((d: Record<string, unknown>) => (d.properties as Record<string, string>)?.hubspot_owner_id)
      .filter(Boolean)
  ))

  // 2. Try multiple endpoints to get all users/owners
  const allOwners: Record<string, { firstName: string; lastName: string; email: string }> = {}

  // Try /crm/v3/owners
  const ownersRes = await fetch(`${HS}/crm/v3/owners?limit=200&includeDeactivated=true`, {
    headers: auth(), cache: 'no-store',
  })
  if (ownersRes.ok) {
    const ownersData = await ownersRes.json()
    for (const o of ownersData.results ?? []) {
      allOwners[String(o.id)] = { firstName: o.firstName ?? '', lastName: o.lastName ?? '', email: o.email ?? '' }
    }
  }

  // Try /settings/v3/users (requires settings.users.read scope)
  const usersRes = await fetch(`${HS}/settings/v3/users/?limit=100`, {
    headers: auth(), cache: 'no-store',
  })
  const usersData = usersRes.ok ? await usersRes.json() : null

  // Try /crm/v3/owners with userId field
  const ownersV2Res = await fetch(`${HS}/crm/v3/owners?limit=200`, {
    headers: auth(), cache: 'no-store',
  })
  const ownersV2Data = ownersV2Res.ok ? await ownersV2Res.json() : null

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
    dealOwnerIds: dealOwnerIds.length,
    known,
    unknown,
    crm_owners: Object.entries(allOwners).map(([id, o]) => ({ id, ...o })),
    settings_users: usersData,
    owners_v2: ownersV2Data?.results?.map((o: Record<string, unknown>) => ({
      id: o.id, userId: o.userId, firstName: o.firstName, lastName: o.lastName, email: o.email,
    })),
  })
}
