const HOST  = process.env.DATABRICKS_HOST
const TOKEN = process.env.DATABRICKS_TOKEN
const WH_ID = process.env.DATABRICKS_WAREHOUSE_ID

export interface UsageStats {
  // Platform usage — Flowbox UGC (ugc_company_level_usage)
  lastActiveDate:     string | null
  activeDays30:       number
  flows30d:           number
  platformDays:       number
  // KPIs — Flowbox UGC (ugc_company_level_kpis)
  conversions30d:     number
  orders30d:          number
  engagements30d:     number
  collectedPosts30d:  number
  // Influencer Marketing — Dreaminfluence
  imCompanyId:        number | null
  totalTeams:         number
  totalInfluencers:   number
  activeCampaigns:    number
  lastActivity:       string | null  // last influencer joined_at (Amplitude needed for brand login)
  // Chargebee billing (approximate — data being reworked)
  cbStatus:           string | null
  cbTermEnd:          string | null
  cbCancelScheduled:  string | null
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
    // Databricks REST API returns plain arrays: [["val1", "val2"]]
    // The MCP uses {values: [{string_value: "..."}]} format — handle both
    return (data.result?.data_array ?? []).map((row: unknown) => {
      if (Array.isArray(row)) return row
      const r = row as { values?: { string_value?: string }[] }
      return r.values?.map((v) => v?.string_value ?? null) ?? row
    })
  } catch (err) {
    console.error('Databricks error:', err)
    return null
  }
}

export async function getUsageStats(
  ugcCompanyId: string,
  hubspotCompanyId: string,
  brand: 'flowbox' | 'dream' | 'both' | null = null,
): Promise<UsageStats | null> {
  if (!HOST || !TOKEN || !WH_ID) return null

  const needsUGC = brand === 'flowbox' || brand === 'both' || brand === null
  const needsIM  = brand === 'dream'   || brand === 'both'

  const id = parseInt(ugcCompanyId, 10)
  const ugcValid = !isNaN(id) && ugcCompanyId !== ''

  // Need at least one data source
  if (!ugcValid && !needsIM) return null

  // Run queries in parallel — only run UGC queries if we have a valid ugc ID
  const [usageRows, kpiRows, cbRows, imLookupRows] = await Promise.all([

    // 1. Flowbox UGC usage
    ugcValid && needsUGC ? runQuery(`
      SELECT
        -- Last day with REAL activity (not just a zero-filled row)
        MAX(CASE WHEN (
          distributed_post_to_a_flow > 0
          OR approved_posts > 0
          OR rights_request_sent_by_comment > 0
          OR rights_request_sent_by_dm > 0
          OR added_tag_to_a_post > 0
          OR created_publish_post > 0
        ) THEN date_day END) AS last_active,
        SUM(CASE WHEN (
          distributed_post_to_a_flow > 0
          OR approved_posts > 0
          OR rights_request_sent_by_comment > 0
          OR rights_request_sent_by_dm > 0
          OR added_tag_to_a_post > 0
          OR created_publish_post > 0
        ) THEN 1 ELSE 0 END) AS active_days_30,
        SUM(distributed_post_to_a_flow) AS flows_30d
      FROM core.main.ugc_company_level_usage
      WHERE ugc_company_id = ${id}
        AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)
    `) : Promise.resolve(null),

    // 2. Flowbox UGC KPIs
    ugcValid && needsUGC ? runQuery(`
      SELECT
        SUM(conversions)     AS conversions_30d,
        SUM(total_orders)    AS orders_30d,
        SUM(engagements)     AS engagements_30d,
        SUM(collected_posts) AS collected_posts_30d
      FROM core.main.ugc_company_level_kpis
      WHERE ugc_company_id = ${id}
        AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)
    `) : Promise.resolve(null),

    // 3. Chargebee billing + IM company ID lookup
    runQuery(`
      SELECT
        cs.status,
        cs.current_term_end,
        cs.cancel_schedule_created_at,
        cc.im_company_id
      FROM core.main.chargebee_subscriptions cs
      JOIN core.main.chargebee_customers cc ON cs.chargebee_customer_id = cc.chargebee_customer_id
      WHERE cc.hubspot_company_id = '${hubspotCompanyId}'
        AND cs.status != 'cancelled'
      ORDER BY cs.current_term_end DESC
      LIMIT 1
    `),

    // 4. IM lookup — get im_company_id from Chargebee (needed for IM queries)
    needsIM ? runQuery(`
      SELECT im_company_id
      FROM core.main.chargebee_customers
      WHERE hubspot_company_id = '${hubspotCompanyId}'
        AND im_company_id IS NOT NULL
      LIMIT 1
    `) : Promise.resolve(null),
  ])

  // Resolve im_company_id — from chargebee query or im lookup
  const cb = cbRows?.[0]
  const imIdFromCb = cb?.[3] ? parseInt(String(cb[3]), 10) : NaN
  const imIdFromLookup = imLookupRows?.[0]?.[0] ? parseInt(String(imLookupRows[0][0]), 10) : NaN
  const imCompanyId = !isNaN(imIdFromCb) ? imIdFromCb : !isNaN(imIdFromLookup) ? imIdFromLookup : null

  // 5. IM dreamteam stats (needs im_company_id resolved first)
  let imRows: unknown[][] | null = null
  if (needsIM && imCompanyId) {
    imRows = await runQuery(`
      SELECT
        COUNT(DISTINCT dt.dream_team)                                                   AS total_teams,
        COUNT(DISTINCT jta.influencer_id)                                               AS total_influencers,
        COUNT(DISTINCT CASE WHEN da.archived = false
          AND da.start_date <= CURRENT_DATE
          AND (da.end_date IS NULL OR da.end_date >= CURRENT_DATE)
          THEN da.assignment END)                                                        AS active_campaigns,
        MAX(jta.joined_at)                                                              AS last_activity
      FROM core.main.dreamteams dt
      LEFT JOIN core.main.dreamteamassignments da
        ON da.dream_team = dt.dream_team AND da.im_company_id = dt.im_company_id
      LEFT JOIN core.main.joinedteamassignments jta
        ON jta.dream_team = dt.dream_team AND jta.im_company_id = dt.im_company_id
      WHERE dt.im_company_id = ${imCompanyId}
    `)
  }

  // Parse UGC usage
  const u = usageRows?.[0]
  const lastActive   = u?.[0] as string | null ?? null
  const activeDays30 = parseInt(String(u?.[1] ?? '0'), 10) || 0
  const flows30d     = parseInt(String(u?.[2] ?? '0'), 10) || 0
  const platformDays = lastActive
    ? Math.max(0, Math.floor((Date.now() - new Date(lastActive).getTime()) / 86400000))
    : 999

  // Parse UGC KPIs
  const k = kpiRows?.[0]
  const conversions30d    = parseInt(String(k?.[0] ?? '0'), 10) || 0
  const orders30d         = parseInt(String(k?.[1] ?? '0'), 10) || 0
  const engagements30d    = parseInt(String(k?.[2] ?? '0'), 10) || 0
  const collectedPosts30d = parseInt(String(k?.[3] ?? '0'), 10) || 0

  // Parse Chargebee (im_company_id already resolved above)
  const cbStatus          = cb?.[0] as string | null ?? null
  const cbTermEnd         = cb?.[1] ? String(cb[1]).split('T')[0] : null
  const cbCancelScheduled = cb?.[2] ? String(cb[2]).split('T')[0] : null

  // Parse IM stats
  const im = imRows?.[0]
  const totalTeams       = parseInt(String(im?.[0] ?? '0'), 10) || 0
  const totalInfluencers = parseInt(String(im?.[1] ?? '0'), 10) || 0
  const activeCampaigns  = parseInt(String(im?.[2] ?? '0'), 10) || 0
  const lastActivity     = im?.[3] ? String(im[3]).split('T')[0] : null

  return {
    lastActiveDate: lastActive,
    activeDays30,
    flows30d,
    platformDays,
    conversions30d,
    orders30d,
    engagements30d,
    collectedPosts30d,
    imCompanyId,
    totalTeams,
    totalInfluencers,
    activeCampaigns,
    lastActivity,
    cbStatus,
    cbTermEnd,
    cbCancelScheduled,
  }
}

// ─── Debug: return raw query results ─────────────────────────────────────────
export async function debugQueries(ugcCompanyId: string, hubspotCompanyId: string) {
  const id = parseInt(ugcCompanyId, 10)
  const host = process.env.DATABRICKS_HOST
  const token = process.env.DATABRICKS_TOKEN
  const wh = process.env.DATABRICKS_WAREHOUSE_ID

  if (!host || !token || !wh) return { error: 'Databricks env vars not set', host: !!host, token: !!token, wh: !!wh }

  const testQuery = async (label: string, sql: string) => {
    try {
      const res = await fetch(`${host}/api/2.0/sql/statements`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id: wh, statement: sql, wait_timeout: '30s', on_wait_timeout: 'CANCEL' }),
        cache: 'no-store',
      })
      const body = await res.json()
      return { label, status: res.status, state: body.status?.state, error: body.status?.error, rows: body.result?.data_array?.slice(0, 3) }
    } catch (e) { return { label, error: String(e) } }
  }

  const results = await Promise.all([
    testQuery('usage', `SELECT MAX(date_day), COUNT(*) FROM core.main.ugc_company_level_usage WHERE ugc_company_id = ${id} AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)`),
    testQuery('kpis',  `SELECT SUM(conversions), SUM(total_orders) FROM core.main.ugc_company_level_kpis WHERE ugc_company_id = ${id} AND date_day >= DATEADD(DAY, -30, CURRENT_DATE)`),
    testQuery('chargebee', `SELECT cs.status, cs.current_term_end FROM core.main.chargebee_subscriptions cs JOIN core.main.chargebee_customers cc ON cs.chargebee_customer_id = cc.chargebee_customer_id WHERE cc.hubspot_company_id = '${hubspotCompanyId}' LIMIT 1`),
  ])

  return { ugcCompanyId, hubspotCompanyId, results }
}
