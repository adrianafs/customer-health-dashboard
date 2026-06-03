export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function GET() {
  const TOKEN = process.env.HUBSPOT_TOKEN

  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' })

  // Test: search for 2 customers and return raw data
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      limit: 2,
      properties: ['name', 'lifecyclestage', 'total_contract_value', 'hubspot_owner_id', 'nps_status'],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
    }),
  })

  const text = await res.text()
  return NextResponse.json({ status: res.status, body: JSON.parse(text) })
}
