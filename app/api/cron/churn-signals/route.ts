export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { fetchEngagements, analyseEngagements } from '@/lib/hubspot-engagements'
import { getUsageStats } from '@/lib/databricks'
import { writeFile } from 'fs/promises'
import path from 'path'

const HS     = 'https://api.hubapi.com'
const TOKEN  = process.env.HUBSPOT_TOKEN
const SECRET = process.env.CRON_SECRET

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

export const DEMO_SIGNALS_PATH = path.join(process.cwd(), 'demo-churn-signals.json')

export type DemoSignalsMap = Record<string, { signals: string[]; name: string }>

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (SECRET && secret !== SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not configured' }, { status: 500 })

  // 1. Load all customer companies (paginated)
  const companies: { id: string; name: string; platformId: string | null }[] = []
  let after: string | undefined
  do {
    const res = await fetch(`${HS}/crm/v3/objects/companies/search`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        limit: 100,
        ...(after ? { after } : {}),
        properties: ['name', 'churn_risk', 'flowbox_platform_id'],
        filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      }),
    })
    if (!res.ok) return NextResponse.json({ error: 'Failed to load companies' }, { status: 500 })
    const data = await res.json()
    for (const c of data.results ?? []) {
      const p = (c.properties as Record<string, string>)
      if (p.churn_risk === 'true') continue // skip already flagged
      companies.push({
        id: String(c.id),
        name: p.name ?? '',
        platformId: p.flowbox_platform_id ?? null,
      })
    }
    after = data.paging?.next?.after
    if (after) await sleep(300)
  } while (after)

  // 2. Analyse each company
  const demoMap: DemoSignalsMap = {}

  for (const company of companies) {
    try {
      const detected: string[] = []

      // ── Platform usage (Databricks) ───────────────────────────────────────
      if (company.platformId) {
        await sleep(200)
        const usage = await getUsageStats(company.platformId, company.id)
        if (usage && usage.activeDays30 === 0) {
          detected.push('no_platform_login_30d')
        }
      }

      // ── Engagement AI analysis ────────────────────────────────────────────
      await sleep(400)
      const engagements = await fetchEngagements(company.id)
      if (engagements.length > 0) {
        await sleep(200)
        const analysis = await analyseEngagements(engagements, company.name)
        const aiDetected = analysis.churnSignals?.filter(s => s.detected).map(s => s.key) ?? []
        detected.push(...aiDetected)
      }

      if (detected.length > 0) {
        demoMap[company.id] = { signals: [...new Set(detected)], name: company.name }
        console.log(`[churn-signals] ${company.name}: ${detected.join(', ')}`)
      }
    } catch (err) {
      console.error(`[churn-signals] Error for ${company.name}:`, err)
    }
  }

  // 3. Save to JSON — NO HubSpot writes
  await writeFile(DEMO_SIGNALS_PATH, JSON.stringify(demoMap, null, 2), 'utf-8')

  return NextResponse.json({
    processed: companies.length,
    flagged: Object.keys(demoMap).length,
    results: Object.entries(demoMap).map(([id, v]) => ({ companyId: id, company: v.name, signals: v.signals })),
  })
}
