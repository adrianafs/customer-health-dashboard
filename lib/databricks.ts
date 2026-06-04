// Databricks SQL Statement Execution API
// Docs: https://docs.databricks.com/api/workspace/statementexecution

const HOST  = process.env.DATABRICKS_HOST   // e.g. https://adb-xxxx.azuredatabricks.net
const TOKEN = process.env.DATABRICKS_TOKEN
const WH_ID = process.env.DATABRICKS_WAREHOUSE_ID

export interface UsageStats {
  lastActiveDate: string | null   // most recent day with any activity
  activeDays30:   number          // days with distributed_post_to_a_flow > 0 in last 30d
  activeDays60:   number          // days with any activity in last 60d
  flows30d:       number          // total distributed_post_to_a_flow last 30d
  flows60d:       number          // total distributed_post_to_a_flow last 60d
  platformDays:   number          // days since last active (999 if never)
}

export async function getUsageStats(ugcCompanyId: string): Promise<UsageStats | null> {
  if (!HOST || !TOKEN || !WH_ID) return null

  const statement = `
    SELECT
      MAX(date_day)                                                              AS last_active,
      SUM(CASE WHEN date_day >= DATEADD(DAY, -30, CURRENT_DATE)
               AND distributed_post_to_a_flow > 0 THEN 1 ELSE 0 END)           AS active_days_30,
      SUM(CASE WHEN date_day >= DATEADD(DAY, -60, CURRENT_DATE)
               AND (distributed_post_to_a_flow > 0
                 OR approved_posts > 0
                 OR rights_request_sent_by_comment > 0
                 OR rights_request_sent_by_dm > 0) THEN 1 ELSE 0 END)          AS active_days_60,
      SUM(CASE WHEN date_day >= DATEADD(DAY, -30, CURRENT_DATE)
               THEN distributed_post_to_a_flow ELSE 0 END)                     AS flows_30d,
      SUM(CASE WHEN date_day >= DATEADD(DAY, -60, CURRENT_DATE)
               THEN distributed_post_to_a_flow ELSE 0 END)                     AS flows_60d
    FROM core.main.ugc_company_level_usage
    WHERE ugc_company_id = ${parseInt(ugcCompanyId, 10)}
      AND date_day >= DATEADD(DAY, -60, CURRENT_DATE)
  `

  try {
    const res = await fetch(`${HOST}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        warehouse_id: WH_ID,
        statement,
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error('Databricks error:', res.status, await res.text())
      return null
    }

    const data = await res.json()
    if (data.status?.state !== 'SUCCEEDED') {
      console.error('Databricks query failed:', data.status)
      return null
    }

    const row = data.result?.data_array?.[0]
    if (!row) return null

    // Columns: last_active, active_days_30, active_days_60, flows_30d, flows_60d
    const lastActive   = row[0] ?? null
    const activeDays30 = parseInt(row[1] ?? '0', 10) || 0
    const activeDays60 = parseInt(row[2] ?? '0', 10) || 0
    const flows30d     = parseInt(row[3] ?? '0', 10) || 0
    const flows60d     = parseInt(row[4] ?? '0', 10) || 0

    const platformDays = lastActive
      ? Math.max(0, Math.floor((Date.now() - new Date(lastActive).getTime()) / 86400000))
      : 999

    return { lastActiveDate: lastActive, activeDays30, activeDays60, flows30d, flows60d, platformDays }
  } catch (err) {
    console.error('Databricks usage error:', err)
    return null
  }
}
