export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
const CONTRACTS_PIPELINE = '58017946'
const EXCLUDED_STAGES = new Set(['1309169018', '1309169012'])

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

// GET /api/hubspot/diagnose
// Returns a breakdown of why clients might be missing from the dashboard
export async function GET() {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  // 1. Count companies with lifecyclestage=customer
  const coRes = await fetch(`${HS}/crm/v3/objects/companies/search`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({
      limit: 100,
      properties: ['name', 'lifecyclestage'],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
    }),
  })
  const coData = coRes.ok ? await coRes.json() : {}
  const companies = coData.results ?? []
  const coIds = companies.map((c: Record<string, unknown>) => String(c.id))

  if (companies.length === 0) {
    return NextResponse.json({
      problem: 'No companies with lifecyclestage=customer found in HubSpot',
      fix: 'Check that your companies have lifecyclestage set to "customer" in HubSpot',
    })
  }

  // 2. Get deal associations for first 20 companies
  const sampleIds = coIds.slice(0, 20)
  const assocRes = await fetch(`${HS}/crm/v4/associations/company/deal/batch/read`, {
    method: 'POST', headers: auth(), cache: 'no-store',
    body: JSON.stringify({ inputs: sampleIds.map((id: string) => ({ id })) }),
  })
  const assocData = assocRes.ok ? await assocRes.json() : {}

  const coDealIds: Record<string, string[]> = {}
  for (const r of assocData.results ?? []) {
    coDealIds[String(r.from?.id)] = (r.to ?? []).map((t: Record<string, unknown>) => String(t.id))
  }

  const allDealIds = Array.from(new Set(Object.values(coDealIds).flat())) as string[]

  let companiesWithNoDeals = 0
  let companiesWithDealsNotInContractsPipeline = 0
  let companiesWithAllDealsExcluded = 0
  let companiesOk = 0

  const pipelineBreakdown: Record<string, number> = {}
  const stageBreakdown: Record<string, number> = {}

  if (allDealIds.length > 0) {
    // 3. Read the deals
    const dealsRes = await fetch(`${HS}/crm/v3/objects/deals/batch/read`, {
      method: 'POST', headers: auth(), cache: 'no-store',
      body: JSON.stringify({
        inputs: allDealIds.map((id: string) => ({ id })),
        properties: ['dealstage', 'pipeline', 'dealname'],
      }),
    })
    const dealsData = dealsRes.ok ? await dealsRes.json() : {}
    const dealMap: Record<string, { pipeline: string; dealstage: string; dealname: string }> = {}
    for (const d of dealsData.results ?? []) {
      dealMap[String(d.id)] = d.properties ?? {}
      const p = d.properties?.pipeline ?? 'unknown'
      const s = d.properties?.dealstage ?? 'unknown'
      pipelineBreakdown[p] = (pipelineBreakdown[p] ?? 0) + 1
      stageBreakdown[s] = (stageBreakdown[s] ?? 0) + 1
    }

    // 4. Check each sample company
    for (const coId of sampleIds) {
      const dealIds = coDealIds[coId] ?? []
      if (dealIds.length === 0) { companiesWithNoDeals++; continue }

      const deals = dealIds.map(id => dealMap[id]).filter(Boolean)
      const contractDeals = deals.filter(d => d.pipeline === CONTRACTS_PIPELINE)

      if (contractDeals.length === 0) { companiesWithDealsNotInContractsPipeline++; continue }

      const validDeals = contractDeals.filter(d => !EXCLUDED_STAGES.has(d.dealstage ?? ''))
      if (validDeals.length === 0) { companiesWithAllDealsExcluded++; continue }

      companiesOk++
    }
  } else {
    companiesWithNoDeals = sampleIds.length
  }

  // 5. Fetch real pipeline list from HubSpot
  const pipelinesRes = await fetch(`${HS}/crm/v3/pipelines/deals`, {
    headers: auth(), cache: 'no-store',
  })
  const pipelinesData = pipelinesRes.ok ? await pipelinesRes.json() : {}
  const pipelines = (pipelinesData.results ?? []).map((p: Record<string, unknown>) => ({
    id: p.id,
    label: p.label,
    stages: ((p.stages ?? []) as Record<string, unknown>[]).map(s => ({ id: s.id, label: s.label })),
  }))

  // 6. Fetch a raw sample deal to see actual properties
  const sampleDealId = allDealIds[0]
  let sampleDeal = null
  if (sampleDealId) {
    const sampleRes = await fetch(
      `${HS}/crm/v3/objects/deals/${sampleDealId}?properties=dealname,pipeline,dealstage,amount`,
      { headers: auth(), cache: 'no-store' }
    )
    sampleDeal = sampleRes.ok ? await sampleRes.json() : null
  }

  return NextResponse.json({
    summary: {
      totalCustomerCompanies: companies.length,
      sampleChecked: sampleIds.length,
      companiesOk,
      companiesWithNoDeals,
      companiesWithDealsNotInContractsPipeline,
      companiesWithAllDealsExcluded,
    },
    diagnosis: companiesOk === 0
      ? companiesWithNoDeals === sampleIds.length
        ? '❌ Companies have no deals at all'
        : companiesWithDealsNotInContractsPipeline > companiesWithAllDealsExcluded
          ? `❌ Deals exist but NOT in pipeline ${CONTRACTS_PIPELINE} — check CONTRACTS_PIPELINE ID`
          : `❌ All deals in contracts pipeline are in excluded stages (Churned/Contract not started)`
      : `✅ ${companiesOk}/${sampleIds.length} companies have valid deals`,
    pipelineBreakdown,
    stageBreakdown,
    contractsPipelineId: CONTRACTS_PIPELINE,
    excludedStages: Array.from(EXCLUDED_STAGES),
    realPipelines: pipelines,
    sampleDeal,
  })
}
