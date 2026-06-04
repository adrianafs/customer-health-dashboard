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
  const brand      = (searchParams.get('brand') ?? null) as 'flowbox' | 'dream' | 'both' | null
  const isDebug    = searchParams.get('debug') === '1'

  if (!platformId) return NextResponse.json({ error: 'platformId is required' }, { status: 400 })
  if (!process.env.DATABRICKS_HOST) return NextResponse.json({ error: 'DATABRICKS_HOST not configured' }, { status: 500 })

  if (isDebug) {
    const { debugQueries } = await import('@/lib/databricks')
    const result = await debugQueries(platformId, companyId)
    return NextResponse.json(result)
  }

  // raw=1 shows exactly what runQuery returns before parsing
  if (searchParams.get('raw') === '1') {
    const HOST = process.env.DATABRICKS_HOST
    const TOKEN = process.env.DATABRICKS_TOKEN
    const WH_ID = process.env.DATABRICKS_WAREHOUSE_ID
    const id = parseInt(platformId, 10)
    const sql = `SELECT MAX(date_day) AS last_active, SUM(CASE WHEN distributed_post_to_a_flow > 0 THEN 1 ELSE 0 END) AS active_days_30, SUM(distributed_post_to_a_flow) AS flows_30d FROM core.main.ugc_company_level_usage WHERE ugc_company_id = ${id} AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)`
    const res = await fetch(`${HOST}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouse_id: WH_ID, statement: sql, wait_timeout: '30s', on_wait_timeout: 'CANCEL' }),
      cache: 'no-store',
    })
    const raw = await res.json()
    return NextResponse.json({ status: res.status, raw })
  }

  const cacheKey = `${platformId}:${companyId}:${brand}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return NextResponse.json({ ...cached.data, cached: true })

  const data = await getUsageStats(platformId, companyId, brand)
  if (!data) return NextResponse.json({ error: 'No data available' }, { status: 404 })

  cache.set(cacheKey, { data, expiresAt: Date.now() + TTL })
  return NextResponse.json(data)
}
