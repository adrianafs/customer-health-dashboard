export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getEngagementDataForCompany, EngagementResult } from '@/lib/hubspot-engagements'

// ── 15-minute in-process cache ────────────────────────────────────────────────
interface CacheEntry { data: EngagementResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

// GET /api/engagements?id=companyId&name=CompanyName
export async function GET(req: NextRequest) {
  if (!process.env.HUBSPOT_TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const companyId   = searchParams.get('id')   ?? ''
  const companyName = searchParams.get('name') ?? ''

  if (!companyId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const cached = cache.get(companyId)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ ...cached.data, cached: true })
  }

  const data = await getEngagementDataForCompany(companyId, companyName)
  cache.set(companyId, { data, expiresAt: Date.now() + TTL })

  return NextResponse.json(data)
}
