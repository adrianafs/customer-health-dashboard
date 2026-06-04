/**
 * GET /api/slack/weekly-digest
 *
 * Weekly portfolio review per CSM. Runs Friday afternoon (vercel.json).
 *   1. Fetches accounts from HubSpot
 *   2. Compares against last week's snapshot (Vercel KV / Upstash REST) for a true diff
 *   3. Claude writes one short analysis line from current state + diff
 *   4. Sends an aesthetic, compact Slack DM
 *   5. Stores this week's snapshot for next week
 *
 * Week-over-week diff requires KV_REST_API_URL + KV_REST_API_TOKEN env vars
 * (added automatically when you connect Vercel KV / Upstash). Without them it
 * gracefully sends a current-state-only review.
 *
 * Manual run: /api/slack/weekly-digest  ·  single CSM: ?csm=Claudia+Núñez
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://customer-health-dashboard-omega.vercel.app'

const CSM_SLACK_IDS: Record<string, string> = {
  'Analicia Montealegre': 'U03KF7ZLRAQ',
  'Cecile Gautier':       'U07FQBYCDTJ',
  'Chantal van den Berg': 'U03LPP7UC8Z',
  'Christina Holm':       'U09D046TBPD',
  'Claudia Núñez':        'U06ND30NU4R',
  'Frida Lindqvist':      'U026LJ6E99C',
  'Sophia Jonsson':       'U086MAKFWQ7',
  'Sandra Vinsa':         'U05JJPYMMM4',
  'Oktawia Gardecka':     'U03KJJYQTAT',
  'Jerry de Waart':       'U0AQ6RVGT5Y',
  'Jana Khoraizat':       'U09D045L75Z',
  'Jean Bouaziz':         'U0ACRTMJU65',
}

const STATE_LABEL: Record<string, string> = {
  churn_risk: 'Churn Risk', action_required: 'Action Required',
  keep_an_eye: 'Keep an Eye', stable: 'Stable',
}

// ─── Vercel KV / Upstash REST (optional) ──────────────────────────────────────
const KV_URL   = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN
const kvOn = !!(KV_URL && KV_TOKEN)

async function kvCmd(cmd: unknown[]): Promise<any> {
  const res = await fetch(KV_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!res.ok) throw new Error(`KV ${res.status}`)
  return res.json()
}
async function kvGet(key: string): Promise<any | null> {
  if (!kvOn) return null
  try { const { result } = await kvCmd(['GET', key]); return result ? JSON.parse(result) : null }
  catch { return null }
}
async function kvSet(key: string, value: unknown, ttlSec = 1209600 /* 2 weeks */) {
  if (!kvOn) return
  try { await kvCmd(['SET', key, JSON.stringify(value), 'EX', ttlSec]) } catch { /* ignore */ }
}

// ─── Data ─────────────────────────────────────────────────────────────────────
async function fetchAccounts(): Promise<any[]> {
  const res = await fetch(`${APP_URL}/api/hubspot/companies`, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`)
  const data = await res.json()
  return data.clients ?? []
}

type Snapshot = Record<string, { s: string; arr: number; renewal: string | null }>

function snapshotOf(accounts: any[]): Snapshot {
  const snap: Snapshot = {}
  for (const a of accounts) snap[a.id] = { s: a.healthState, arr: a.arr ?? 0, renewal: a.contract?.renewal ?? null }
  return snap
}

function daysUntil(s: string | null): number | null {
  if (!s) return null
  return Math.ceil((new Date(s).getTime() - Date.now()) / 86400000)
}

// ─── Diff vs last week ──────────────────────────────────────────────────────────
function computeDiff(accounts: any[], prev: Snapshot | null) {
  const worsened: string[] = []
  const improved: string[] = []
  const newChurn: string[] = []
  let prevAtRisk = 0

  const RANK: Record<string, number> = { stable: 0, keep_an_eye: 1, action_required: 2, churn_risk: 3 }
  if (prev) {
    for (const [id, p] of Object.entries(prev)) {
      if (['action_required', 'churn_risk'].includes(p.s)) prevAtRisk += p.arr
    }
    for (const a of accounts) {
      const p = prev[a.id]
      if (!p) continue
      const before = RANK[p.s] ?? 0, after = RANK[a.healthState] ?? 0
      if (after > before) {
        worsened.push(a.name)
        if (a.healthState === 'churn_risk' && p.s !== 'churn_risk') newChurn.push(a.name)
      } else if (after < before) {
        improved.push(a.name)
      }
    }
  }
  return { worsened, improved, newChurn, prevAtRisk, hasPrev: !!prev }
}

// ─── Claude analysis (one short line) ───────────────────────────────────────────
async function analyse(firstName: string, m: any, diff: any): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return m.urgent > 0
      ? `${m.urgent} accounts need attention and €${m.atRiskARR.toLocaleString()} is at risk this week.`
      : `Portfolio is healthy — nothing urgent on the radar.`
  }
  const trend = diff.hasPrev
    ? `vs last week: ${diff.worsened.length} declined (${diff.worsened.slice(0,3).join(', ') || 'none'}), ${diff.improved.length} improved.`
    : `(no prior week to compare).`
  const prompt = `You are a sharp CS analyst writing ONE sentence (max 22 words) for ${firstName}'s weekly portfolio review.
State: ${m.total} accounts, €${m.totalARR.toLocaleString()} ARR, ${m.churn} churn-risk, ${m.action} action-required, €${m.atRiskARR.toLocaleString()} at risk. ${diff.newChurn.length ? 'New churn risks: ' + diff.newChurn.join(', ') + '.' : ''} ${trend}
Be specific and motivating; name 1 account if relevant. No greeting, no sign-off, no emoji.`
  try {
    const r = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 120, messages: [{ role: 'user', content: prompt }] })
    return r.content.find(b => b.type === 'text')?.text?.trim() ?? ''
  } catch { return `${m.urgent} accounts need attention; €${m.atRiskARR.toLocaleString()} at risk.` }
}

// ─── Slack message ──────────────────────────────────────────────────────────────
async function sendDM(slackId: string, csmName: string, accounts: any[], m: any, diff: any, analysis: string) {
  const firstName = csmName.split(' ')[0]
  const arrTrend = diff.hasPrev
    ? (m.atRiskARR > diff.prevAtRisk ? `▲ €${(m.atRiskARR - diff.prevAtRisk).toLocaleString()} vs last week`
      : m.atRiskARR < diff.prevAtRisk ? `▼ €${(diff.prevAtRisk - m.atRiskARR).toLocaleString()} vs last week`
      : 'no change vs last week')
    : ''

  // Top 3 accounts to focus on — churn first, then action, soonest renewal as tiebreak
  const RANK: Record<string, number> = { churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3 }
  const focus = [...accounts]
    .filter(a => ['churn_risk', 'action_required'].includes(a.healthState))
    .sort((a, b) => (RANK[a.healthState] - RANK[b.healthState]) || ((daysUntil(a.contract?.renewal) ?? 9999) - (daysUntil(b.contract?.renewal) ?? 9999)))
    .slice(0, 3)

  const focusLines = focus.map(a => {
    const dot = a.healthState === 'churn_risk' ? '🔴' : '🟠'
    const dtr = daysUntil(a.contract?.renewal)
    const ren = dtr && dtr > 0 && dtr <= 90 ? ` · renews in ${dtr}d` : ''
    return `${dot} *${a.name}* — €${(a.arr ?? 0).toLocaleString()}${ren}`
  }).join('\n')

  // What changed this week (compact)
  let changeLine = ''
  if (diff.hasPrev) {
    const parts: string[] = []
    if (diff.newChurn.length) parts.push(`🆕 New churn risk: *${diff.newChurn.slice(0,3).join(', ')}*`)
    if (diff.worsened.length) parts.push(`↘️ Declined: ${diff.worsened.length}`)
    if (diff.improved.length) parts.push(`↗️ Improved: ${diff.improved.length}`)
    changeLine = parts.length ? parts.join('  ·  ') : '✨ No movement — steady week.'
  }

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `📈 Weekly review — ${firstName}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Week of ${today} · Customer Health` }] },
    { type: 'section', text: { type: 'mrkdwn', text: `_${analysis}_` } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Accounts*\n${m.total}` },
        { type: 'mrkdwn', text: `*Total ARR*\n€${m.totalARR.toLocaleString()}` },
        { type: 'mrkdwn', text: `*🔴 Churn · 🟠 Action*\n${m.churn} · ${m.action}` },
        { type: 'mrkdwn', text: `*At-risk ARR*\n€${m.atRiskARR.toLocaleString()}${arrTrend ? `\n${arrTrend}` : ''}` },
      ],
    },
  ]

  if (changeLine) {
    blocks.push({ type: 'divider' })
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*This week*\n${changeLine}` } })
  }

  if (focusLines) {
    blocks.push({ type: 'divider' })
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Focus next week*\n${focusLines}` } })
  }

  blocks.push({
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: '📊 Open dashboard', emoji: true }, url: APP_URL, style: m.urgent > 0 ? 'danger' : 'primary' }],
  })

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: slackId, text: `Your weekly CS review — ${today}`, blocks }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack error for ${csmName}: ${data.error}`)
  return data
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const targetCsm = req.nextUrl.searchParams.get('csm')
  if (!SLACK_TOKEN) return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured' }, { status: 503 })

  try {
    const allAccounts = await fetchAccounts()

    const byCsm: Record<string, any[]> = {}
    for (const a of allAccounts) {
      const name = a.csm
      if (!name || name === 'Unassigned') continue
      ;(byCsm[name] ??= []).push(a)
    }

    const results: { csm: string; status: string; error?: string }[] = []

    for (const [csmName, accounts] of Object.entries(byCsm)) {
      if (targetCsm && csmName !== targetCsm) continue
      const slackId = CSM_SLACK_IDS[csmName]
      if (!slackId) { results.push({ csm: csmName, status: 'skipped — no Slack ID' }); continue }

      try {
        const churnRisk = accounts.filter(a => a.healthState === 'churn_risk')
        const action    = accounts.filter(a => a.healthState === 'action_required')
        const urgent    = [...churnRisk, ...action]
        const m = {
          total: accounts.length,
          churn: churnRisk.length,
          action: action.length,
          urgent: urgent.length,
          totalARR: accounts.reduce((s, a) => s + (a.arr ?? 0), 0),
          atRiskARR: urgent.reduce((s, a) => s + (a.arr ?? 0), 0),
        }

        const key = `wk-snapshot:${csmName}`
        const prev = await kvGet(key) as Snapshot | null
        const diff = computeDiff(accounts, prev)
        const analysis = await analyse(csmName.split(' ')[0], m, diff)

        await sendDM(slackId, csmName, accounts, m, diff, analysis)
        await kvSet(key, snapshotOf(accounts))

        results.push({ csm: csmName, status: kvOn ? 'sent ✓ (diff on)' : 'sent ✓ (current-state only)' })
        await new Promise(r => setTimeout(r, 500))
      } catch (err: any) {
        results.push({ csm: csmName, status: 'failed', error: err.message })
      }
    }

    return NextResponse.json({
      success: true,
      kvEnabled: kvOn,
      date: new Date().toISOString(),
      results,
      totalSent: results.filter(r => r.status.startsWith('sent')).length,
      totalFailed: results.filter(r => r.status === 'failed').length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
