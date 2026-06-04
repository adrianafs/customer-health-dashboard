export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Get all unique owner IDs from the first 50 customers
  const coRes = await fetch(`${HS}/crm/v3/objects/companies/search`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({
      limit: 50,
      properties: ['name', 'hubspot_owner_id'],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
    }),
  })
  const coData = coRes.ok ? await coRes.json() : {}
  const uniqueIds = Array.from(new Set(
    (coData.results ?? []).map((c: Record<string, unknown>) => (c.properties as Record<string, string>)?.hubspot_owner_id).filter(Boolean)
  )) as string[]

  // Fetch each owner individually
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

  return NextResponse.json({ uniqueOwnerIds: uniqueIds.length, owners })
}
