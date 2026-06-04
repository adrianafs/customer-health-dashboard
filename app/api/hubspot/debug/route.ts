export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Fetch 3 customer companies with all relevant owner fields
  const res = await fetch(`${HS}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: auth(),
    cache: 'no-store',
    body: JSON.stringify({
      limit: 3,
      properties: ['name', 'hubspot_owner_id', 'ownername', 'owneremail', 'total_contract_value'],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
    }),
  })
  const data = res.ok ? await res.json() : { error: await res.text() }

  return NextResponse.json({
    total: data.total,
    sample: data.results?.map((c: Record<string, unknown>) => ({
      id: c.id,
      props: c.properties,
    })),
  })
}
