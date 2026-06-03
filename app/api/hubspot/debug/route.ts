export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Get stages for the Contracts pipeline
  const stagesRes = await fetch(`${HS}/crm/v3/pipelines/deals/58017946/stages`, { headers: auth(), cache: 'no-store' })
  const stages = stagesRes.ok ? await stagesRes.json() : { error: await stagesRes.text() }

  // Get 5 deals from the contracts pipeline with their stages
  const searchRes = await fetch(`${HS}/crm/v3/objects/deals/search`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({
      limit: 5,
      properties: ['dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'amount'],
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: '58017946' }] }],
    }),
  })
  const deals = searchRes.ok ? await searchRes.json() : { error: await searchRes.text() }

  return NextResponse.json({
    contractsStages: stages?.results?.map((s: Record<string, unknown>) => ({ id: s.id, label: s.label })) ?? stages,
    sampleDeals: deals?.results?.map((d: Record<string, unknown>) => ({ id: d.id, props: d.properties })) ?? deals,
    total: deals?.total ?? 0,
  })
}
