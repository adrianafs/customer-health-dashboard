const HOST  = process.env.DATABRICKS_HOST
const TOKEN = process.env.DATABRICKS_TOKEN
const WH_ID = process.env.DATABRICKS_WAREHOUSE_ID

export interface UsageStats {
  // Platform usage (ugc_company_level_usage)
  lastActiveDate:     string | null
  activeDays30:       number
  flows30d:           number
  platformDays:       number
  // KPIs (ugc_company_level_kpis)
  conversions30d:     number
  orders30d:          number
  engagements30d:     number
  collectedPosts30d:  number
  // Chargebee billing (approximate — data being reworked)
  cbStatus:           string | null  // active, non_renewing, paused, cancelled…
  cbTermEnd:          string | null  // current_term_end date
  cbCancelScheduled:  string | null  // non-null = cancellation scheduled
}

async function runQuery(statement: string): Promise<unknown[][] | null> {
  if (!HOST || !TOKEN || !WH_ID) return null
  try {
    const res = await fetch(`${HOST}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_id: WH_ID,
        statement,
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
      }),
      cache: 'no-store',
    })
    if (!res.ok) { console.error('Databricks error:', res.status, await res.text()); return null }
    const data = await res.json()
    if (data.status?.state !== 'SUCCEEDED') { console.error('Query failed:', data.status); return null }
    return (data.result?.data_array ?? []).map((row: { values: { string_value?: string }[] }) =>
      row.values?.map((v: { string_value?: string }) => v?.string_value ?? null) ?? row
    )
  } catch (err) {
    console.error('Databricks error:', err)
    return null
  }
}

export async function getUsageStats(
  ugcCompanyId: string,
  hubspotCompanyId: string,
): Promise<UsageStats | null> {
  if (!HOST || !TOKEN || !WH_ID) return null

  const id = parseInt(ugcCompanyId, 10)
  if (isNaN(id)) return null

  // Run all three queries in parallel
  const [usageRows, kpiRows, cbRows] = await Promise.all([

    // 1. Platform usage
    runQuery(`
      SELECT
        MAX(date_day) AS last_active,
        SUM(CASE WHEN distributed_post_to_a_flow > 0 THEN 1 ELSE 0 END) AS active_days_30,
        SUM(distributed_post_to_a_flow) AS flows_30d
      FROM core.main.ugc_company_level_usage
      WHERE ugc_company_id = ${id}
        AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)
    `),

    // 2. KPIs — conversions, orders, engagements, content collection
    runQuery(`
      SELECT
        SUM(conversions)     AS conversions_30d,
        SUM(total_orders)    AS orders_30d,
        SUM(engagements)     AS engagements_30d,
        SUM(collected_posts) AS collected_posts_30d
      FROM core.main.ugc_company_level_kpis
      WHERE ugc_company_id = ${id}
        AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)
    `),

    // 3. Chargebee subscription status (via HubSpot company ID)
    runQuery(`
      SELECT
        cs.status,
        cs.current_term_end,
        cs.cancel_schedule_created_at
      FROM core.main.chargebee_subscriptions cs
      JOIN core.main.chargebee_customers cc ON cs.chargebee_customer_id = cc.chargebee_customer_id
      WHERE cc.hubspot_company_id = '${hubspotCompanyId}'
        AND cs.status != 'cancelled'
      ORDER BY cs.current_term_end DESC
      LIMIT 1
    `),
  ])

  // Parse usage
  const u = usageRows?.[0]
  const lastActive   = u?.[0] as string | null ?? null
  const activeDays30 = parseInt(String(u?.[1] ?? '0'), 10) || 0
  const flows30d     = parseInt(String(u?.[2] ?? '0'), 10) || 0
  const platformDays = lastActive
    ? Math.max(0, Math.floor((Date.now() - new Date(lastActive).getTime()) / 86400000))
    : 999

  // Parse KPIs
  const k = kpiRows?.[0]
  const conversions30d    = parseInt(String(k?.[0] ?? '0'), 10) || 0
  const orders30d         = parseInt(String(k?.[1] ?? '0'), 10) || 0
  const engagements30d    = parseInt(String(k?.[2] ?? '0'), 10) || 0
  const collectedPosts30d = parseInt(String(k?.[3] ?? '0'), 10) || 0

  // Parse Chargebee
  const cb = cbRows?.[0]
  const cbStatus          = cb?.[0] as string | null ?? null
  const cbTermEnd         = cb?.[1] ? String(cb[1]).split('T')[0] : null
  const cbCancelScheduled = cb?.[2] ? String(cb[2]).split('T')[0] : null

  return {
    lastActiveDate: lastActive,
    activeDays30,
    flows30d,
    platformDays,
    conversions30d,
    orders30d,
    engagements30d,
    collectedPosts30d,
    cbStatus,
    cbTermEnd,
    cbCancelScheduled,
  }
}
