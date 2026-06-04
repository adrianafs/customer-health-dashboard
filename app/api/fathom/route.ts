export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getFathomDataForCompany, FathomCompanyResult } from '@/lib/fathom'

// ── 15-minute in-process cache ────────────────────────────────────────────────
interface CacheEntry { data: FathomCompanyResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000 // 15 minutes

export async function GET(req: NextRequest) {
  if (!process.env.FATHOM_API_KEY) {
    return NextResponse.json({ error: 'FATHOM_API_KEY not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const companyName = searchParams.get('name') ?? ''
  const companyId   = searchParams.get('id')   ?? ''
  const csmEmail    = searchParams.get('csm')  ?? undefined

  if (!companyName || !companyId) {
    return NextResponse.json({ error: 'name and id are required' }, { status: 400 })
  }

  const cacheKey = `${companyId}:${companyName}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ ...cached.data, cached: true })
  }

  const data = await getFathomDataForCompany(companyName, companyId, csmEmail)
  cache.set(cacheKey, { data, expiresAt: Date.now() + TTL })

  return NextResponse.json(data)
}
