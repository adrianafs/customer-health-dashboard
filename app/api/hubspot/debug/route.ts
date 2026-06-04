export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
function auth() { return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Stages of the contracts pipeline
  const stagesRes = await fetch(`${HS}/crm/v3/pipelines/deals/58017946/stages`, { headers: auth(), cache: 'no-store' })
  const stages = stagesRes.ok ? await stagesRes.json() : { error: await stagesRes.text() }

  // All deals in contracts pipeline — NO owner filter — show real owner IDs
  const searchRes = await fetch(`${HS}/crm/v3/objects/deals/search`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({
      limit: 10,
      properties: ['dealname', 'dealstage', 'hubspot_owner_id', 'amount'],
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: '58017946' }] }],
    }),
  })
  const deals = searchRes.ok ? await searchRes.json() : { error: await searchRes.text() }

  // All HubSpot owners so we can match IDs to names
  const ownersRes = await fetch(`${HS}/crm/v3/owners?limit=100`, { headers: auth(), cache: 'no-store' })
  const owners = ownersRes.ok ? await ownersRes.json() : { error: await ownersRes.text() }

  return NextResponse.json({
    totalDealsInPipeline: deals?.total ?? 0,
    stages: stages?.results?.map((s: Record<string, unknown>) => ({ id: s.id, label: s.label })) ?? stages,
    sampleDeals: deals?.results?.map((d: Record<string, unknown>) => ({ id: d.id, props: d.properties })) ?? deals,
    owners: owners?.results?.map((o: Record<string, unknown>) => ({ id: o.id, name: `${o.firstName} ${o.lastName}`, email: o.email })) ?? owners,
  })
}
