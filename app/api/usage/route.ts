export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getUsageStats, UsageStats } from '@/lib/databricks'

// 15-minute cache
interface CacheEntry { data: UsageStats; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

// GET /api/usage?platformId=1973&companyId=31134448225
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const platformId = searchParams.get('platformId') ?? ''
  const companyId  = searchParams.get('companyId')  ?? ''

  if (!platformId) return NextResponse.json({ error: 'platformId is required' }, { status: 400 })
  if (!process.env.DATABRICKS_HOST) return NextResponse.json({ error: 'DATABRICKS_HOST not configured' }, { status: 500 })

  const cacheKey = `${platformId}:${companyId}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return NextResponse.json({ ...cached.data, cached: true })

  const data = await getUsageStats(platformId, companyId)
  if (!data) return NextResponse.json({ error: 'No data available' }, { status: 404 })

  cache.set(cacheKey, { data, expiresAt: Date.now() + TTL })
  return NextResponse.json(data)
}
