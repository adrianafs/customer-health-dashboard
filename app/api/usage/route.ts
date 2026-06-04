export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getUsageStats, UsageStats } from '@/lib/databricks'

// 15-minute cache
interface CacheEntry { data: UsageStats; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

// GET /api/usage?platformId=2044&companyId=31134448225
// GET /api/usage?debug=1&platformId=2044&companyId=31134448225  → raw queries
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const platformId = searchParams.get('platformId') ?? ''
  const companyId  = searchParams.get('companyId')  ?? ''
  const isDebug    = searchParams.get('debug') === '1'

  if (!platformId) return NextResponse.json({ error: 'platformId is required' }, { status: 400 })
  if (!process.env.DATABRICKS_HOST) return NextResponse.json({ error: 'DATABRICKS_HOST not configured' }, { status: 500 })

  if (isDebug) {
    const { debugQueries } = await import('@/lib/databricks')
    const result = await debugQueries(platformId, companyId)
    return NextResponse.json(result)
  }

  const cacheKey = `${platformId}:${companyId}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return NextResponse.json({ ...cached.data, cached: true })

  const data = await getUsageStats(platformId, companyId)
  if (!data) return NextResponse.json({ error: 'No data available' }, { status: 404 })

  cache.set(cacheKey, { data, expiresAt: Date.now() + TTL })
  return NextResponse.json(data)
}
