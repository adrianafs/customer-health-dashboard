export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

const HS    = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

export async function POST(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  const { companyId } = await req.json()
  if (!companyId) return NextResponse.json({ error: 'missing companyId' }, { status: 400 })

  const res = await fetch(`${HS}/crm/v3/objects/companies/${companyId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { churn_risk: 'true' } }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('flag-churn error:', err)
    return NextResponse.json({ error: err }, { status: res.status })
  }

  return NextResponse.json({ ok: true })
}
