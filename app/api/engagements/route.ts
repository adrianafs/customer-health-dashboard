export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getEngagementDataForCompany, EngagementResult } from '@/lib/hubspot-engagements'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

// ── 15-minute in-process cache ────────────────────────────────────────────────
interface CacheEntry { data: EngagementResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

// GET /api/engagements?id=companyId&name=CompanyName
// GET /api/engagements?test=1&id=companyId  → raw API test, no Claude
export async function GET(req: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const companyId   = searchParams.get('id')   ?? ''
  const companyName = searchParams.get('name') ?? ''
  const isTest      = searchParams.get('test') === '1'

  if (!companyId) {
    return NextResponse.json({ error: 'id is required — add ?id=COMPANY_ID' }, { status: 400 })
  }

  // Test mode: raw API response to debug scope issues
  if (isTest) {
    const auth = { Authorization: `Bearer ${TOKEN}` }
    const url = `${HS}/engagements/v1/engagements/associated/COMPANY/${companyId}/paged?limit=5`
    const res = await fetch(url, { headers: auth, cache: 'no-store' })
    const body = await res.text()
    return NextResponse.json({ status: res.status, url, body: JSON.parse(body) })
  }

  const cached = cache.get(companyId)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ ...cached.data, cached: true })
  }

  const data = await getEngagementDataForCompany(companyId, companyName)
  cache.set(companyId, { data, expiresAt: Date.now() + TTL })

  return NextResponse.json(data)
}
