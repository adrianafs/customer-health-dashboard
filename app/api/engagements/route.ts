export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getEngagementDataForCompany, EngagementResult } from '@/lib/hubspot-engagements'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

interface CacheEntry { data: EngagementResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const companyId   = searchParams.get('id')   ?? ''
  const companyName = searchParams.get('name') ?? ''
  const isTest      = searchParams.get('test') === '1'

  if (!companyId) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Test mode: try associations v4 → batch read for each activity type
  if (isTest) {
    const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
    const results: Record<string, unknown> = {}

    for (const type of ['notes', 'emails', 'meetings', 'calls'] as const) {
      // Step 1: get IDs via associations
      const assocRes = await fetch(`${HS}/crm/v4/associations/company/${type}/batch/read`, {
        method: 'POST', headers: auth, cache: 'no-store',
        body: JSON.stringify({ inputs: [{ id: companyId }] }),
      })
      if (!assocRes.ok) {
        results[type] = { assocStatus: assocRes.status, error: await assocRes.text() }
        continue
      }
      const assocData = await assocRes.json()
      const ids = (assocData.results?.[0]?.to ?? [])
        .map((t: Record<string, unknown>) => String(t.toObjectId ?? t.id ?? ''))
        .filter(Boolean)
        .slice(0, 3)

      if (ids.length === 0) {
        results[type] = { assocStatus: 200, ids: 0 }
        continue
      }

      // Step 2: batch read to get properties
      const props: Record<string, string[]> = {
        notes:    ['hs_note_body', 'hs_timestamp'],
        emails:   ['hs_email_subject', 'hs_email_text', 'hs_timestamp'],
        meetings: ['hs_meeting_title', 'hs_meeting_body', 'hs_timestamp'],
        calls:    ['hs_call_body', 'hs_call_title', 'hs_timestamp'],
      }
      const batchRes = await fetch(`${HS}/crm/v3/objects/${type}/batch/read`, {
        method: 'POST', headers: auth, cache: 'no-store',
        body: JSON.stringify({ inputs: ids.map((id: string) => ({ id })), properties: props[type] }),
      })
      const batchData = batchRes.ok ? await batchRes.json() : null
      results[type] = { assocStatus: 200, totalIds: ids.length, sample: batchData?.results?.slice(0, 2) }
    }

    return NextResponse.json({ companyId, results })
  }

  const cached = cache.get(companyId)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ ...cached.data, cached: true })
  }

  const data = await getEngagementDataForCompany(companyId, companyName)
  cache.set(companyId, { data, expiresAt: Date.now() + TTL })
  return NextResponse.json(data)
}
