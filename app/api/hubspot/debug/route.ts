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

  // 1. Get deal pipelines to find the right pipeline IDs
  const pipelinesRes = await fetch(`${HS}/crm/v3/pipelines/deals`, { headers: auth(), cache: 'no-store' })
  const pipelines = pipelinesRes.ok ? await pipelinesRes.json() : { error: await pipelinesRes.text() }

  // 2. Fetch any 3 deals with no filter to confirm deals API works
  const anyDealsRes = await fetch(`${HS}/crm/v3/objects/deals?limit=3&properties=dealname,dealstage,pipeline,hubspot_owner_id,amount`, {
    headers: auth(), cache: 'no-store'
  })
  const anyDeals = anyDealsRes.ok ? await anyDealsRes.json() : { error: await anyDealsRes.text() }

  // 3. Search deals by pipeline 874052773 (no owner filter) to check if pipeline ID is correct
  const searchRes = await fetch(`${HS}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: auth(),
    cache: 'no-store',
    body: JSON.stringify({
      limit: 5,
      properties: ['dealname', 'dealstage', 'pipeline', 'hubspot_owner_id', 'amount'],
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: '874052773' }] }],
    }),
  })
  const pipelineDeals = searchRes.ok ? await searchRes.json() : { error: await searchRes.text() }

  return NextResponse.json({
    pipelines: pipelines?.results?.map((p: Record<string, unknown>) => ({ id: p.id, label: p.label })) ?? pipelines,
    anyDeals: anyDeals?.results?.map((d: Record<string, unknown>) => ({ id: d.id, props: d.properties })) ?? anyDeals,
    pipelineDeals: pipelineDeals?.results?.map((d: Record<string, unknown>) => ({ id: d.id, props: d.properties })) ?? pipelineDeals,
    totalInPipeline: pipelineDeals?.total ?? 0,
  })
}
