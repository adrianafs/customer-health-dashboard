export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { getEngagementDataForCompany, EngagementResult } from '@/lib/hubspot-engagements'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN

interface CacheEntry { data: EngagementResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 15 * 60 * 1000

// GET /api/engagements?id=companyId&name=CompanyName
// GET /api/engagements?test=1&id=companyId  → raw API test
export async function GET(req: NextRequest) {
  if (!TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const companyId   = searchParams.get('id')   ?? ''
  const companyName = searchParams.get('name') ?? ''
  const isTest      = searchParams.get('test') === '1'

  if (!companyId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  // Test mode: try all CRM v3 activity object types
  if (isTest) {
    const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
    const results: Record<string, unknown> = {}

    for (const type of ['notes', 'emails', 'meetings', 'calls'] as const) {
      const res = await fetch(`${HS}/crm/v3/objects/${type}/search`, {
        method: 'POST',
        headers: auth,
        cache: 'no-store',
        body: JSON.stringify({
          limit: 3,
          properties: type === 'notes' ? ['hs_note_body', 'hs_timestamp'] :
                      type === 'emails' ? ['hs_email_subject', 'hs_email_text', 'hs_timestamp'] :
                      type === 'meetings' ? ['hs_meeting_title', 'hs_meeting_body', 'hs_timestamp'] :
                      ['hs_call_body', 'hs_timestamp'],
          filterGroups: [{
            filters: [{ propertyName: 'associations.company', operator: 'EQ', value: companyId }],
          }],
        }),
      })
      const body = await res.json()
      results[type] = { status: res.status, total: body.total, sample: body.results?.slice(0, 2) }
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
