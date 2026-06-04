export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getUsageStats, UsageStats } from '@/lib/databricks'

// 15-minute cache
interface CacheEntry { data: UsageStats; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

// GET /api/usage?platformId=1973
export async function GET(req: NextRequest) {
  const platformId = new URL(req.url).searchParams.get('platformId') ?? ''

  if (!platformId) {
    return NextResponse.json({ error: 'platformId is required' }, { status: 400 })
  }

  if (!process.env.DATABRICKS_HOST) {
    return NextResponse.json({ error: 'DATABRICKS_HOST not configured' }, { status: 500 })
  }

  const cached = cache.get(platformId)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ ...cached.data, cached: true })
  }

  const data = await getUsageStats(platformId)
  if (!data) return NextResponse.json({ error: 'No usage data available' }, { status: 404 })

  cache.set(platformId, { data, expiresAt: Date.now() + TTL })
  return NextResponse.json(data)
}
