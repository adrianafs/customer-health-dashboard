/**
 * GET /api/slack/morning-digest
 *
 * Runs every morning at 8:30am (configured in vercel.json).
 * For each CSM:
 *   1. Fetches their accounts from HubSpot
 *   2. Uses Claude to write a personalised message based on their portfolio
 *   3. Sends a DM to their Slack
 *
 * Can also be triggered manually by visiting the URL.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://customer-health-dashboard-omega.vercel.app'

// ─── CSM Slack User IDs ───────────────────────────────────────────────────────
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

const STATE_EMOJI: Record<string, string> = {
  churn_risk:      '🔴',
  action_required: '🟠',
  keep_an_eye:     '🟡',
  stable:          '🟢',
}

const STATE_LABEL: Record<string, string> = {
  churn_risk:      'Churn Risk',
  action_required: 'Action Required',
  keep_an_eye:     'Keep an Eye',
  stable:          'Stable',
}

// ─── Fetch accounts from HubSpot ─────────────────────────────────────────────
async function fetchAccounts() {
  const res = await fetch(`${APP_URL}/api/hubspot/companies`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`)
  const data = await res.json()
  return data.clients ?? []
}

// ─── Generate personalised message with Claude ────────────────────────────────
async function generateMessage(csmName: string, accounts: any[]): Promise<string> {
  const firstName = csmName.split(' ')[0]
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  const churnRisk      = accounts.filter(a => a.healthState === 'churn_risk')
  const actionRequired = accounts.filter(a => a.healthState === 'action_required')
  const keepAnEye      = accounts.filter(a => a.healthState === 'keep_an_eye')
  const stable         = accounts.filter(a => a.healthState === 'stable')
  const urgent         = [...churnRisk, ...actionRequired]

  const totalARR   = accounts.reduce((s: number, a: any) => s + (a.arr ?? 0), 0)
  const atRiskARR  = urgent.reduce((s: number, a: any) => s + (a.arr ?? 0), 0)

  const accountSummary = accounts.map((a: any) => {
    const dtr = a.contract?.renewal
      ? Math.ceil((new Date(a.contract.renewal).getTime() - Date.now()) / 86400000)
      : null
    return `- ${a.name} (${STATE_LABEL[a.healthState] ?? a.healthState}, €${(a.arr ?? 0).toLocaleString()}, last contact ${a.lastContactDaysAgo}d ago${dtr && dtr > 0 && dtr < 90 ? `, renewal in ${dtr}d` : ''}): ${a.whyThisScore}`
  }).join('\n')

  const prompt = `You are writing a personalised morning Slack message to ${firstName}, a Customer Success Manager at Flowbox.

Today is ${today}.

Their portfolio:
- Total accounts: ${accounts.length}
- Stable: ${stable.length}
- Keep an Eye: ${keepAnEye.length}  
- Action Required: ${actionRequired.length}
- Churn Risk: ${churnRisk.length}
- Total ARR: €${totalARR.toLocaleString()}
- At-risk ARR: €${atRiskARR.toLocaleString()}

Account details:
${accountSummary}

Write a SHORT (max 3 sentences), warm, direct morning message for ${firstName}.

Rules:
- If all accounts are stable: congratulate them warmly and mention something specific about their portfolio
- If there are urgent accounts: be direct about what needs attention today, mention 1-2 specific client names
- If there is churn risk: be clear this needs immediate action, name the accounts
- Always feel personal, never robotic or templated
- Mention specific client names when relevant
- Do NOT use bullet points — write in natural conversational sentences
- Do NOT say "Good morning" — start differently each day
- Keep it under 60 words
- Sign off with something encouraging`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content.find(b => b.type === 'text')?.text ?? `Hi ${firstName}, here's your portfolio update for today.`
}

// ─── Send Slack DM ────────────────────────────────────────────────────────────
async function sendDM(slackId: string, csmName: string, accounts: any[], personalMessage: string) {
  const urgent     = accounts.filter(a => ['churn_risk', 'action_required'].includes(a.healthState))

  // Only list churn-risk and action-required accounts (skip keep-an-eye and stable)
  const accountsToShow = urgent

  const accountLines = accountsToShow.map((a: any) => {
    const emoji = STATE_EMOJI[a.healthState] ?? '⚪'
    const label = STATE_LABEL[a.healthState] ?? a.healthState
    const arr   = `€${(a.arr ?? 0).toLocaleString()}`
    const dtr   = a.contract?.renewal
      ? Math.ceil((new Date(a.contract.renewal).getTime() - Date.now()) / 86400000)
      : null
    const ren   = dtr && dtr > 0 && dtr <= 90 ? ` · renews in ${dtr}d` : ''
    return `${emoji} *${a.name}* (${label} · ${arr}${ren})\n  _${a.whyThisScore}_`
  }).join('\n\n')

  const today    = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const allGood  = urgent.length === 0

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: allGood
          ? `☀️ Good news — ${today}`
          : `📋 Your briefing — ${today}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: personalMessage },
    },
  ]

  if (accountsToShow.length > 0) {
    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Accounts needing attention (${urgent.length}/${accounts.length}):*\n\n${accountLines}`,
      },
    })
  }

  blocks.push({ type: 'divider' })
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${accounts.length} accounts · ${urgent.length} urgent · Generated by Claude`,
      },
    ],
  })
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '📊 Open dashboard', emoji: true },
        url: APP_URL,
        style: urgent.length > 0 ? 'danger' : 'primary',
      },
    ],
  })

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: slackId,
      text: `Your CS briefing for ${today}`,
      blocks,
    }),
  })

  const data = await res.json()
  if (!data.ok) throw new Error(`Slack error for ${csmName}: ${data.error}`)
  return data
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Allow running for a specific CSM only: ?csm=Christina+Holm
  const targetCsm = req.nextUrl.searchParams.get('csm')

  if (!SLACK_TOKEN) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured' }, { status: 503 })
  }

  try {
    // 1. Fetch all accounts
    const allAccounts = await fetchAccounts()

    // 2. Group by CSM name
    const byCsm: Record<string, any[]> = {}
    for (const account of allAccounts) {
      const name = account.csm
      if (!name || name === 'Unassigned') continue
      if (!byCsm[name]) byCsm[name] = []
      byCsm[name].push(account)
    }

    const results: { csm: string; status: string; error?: string }[] = []

    // 3. For each CSM with a Slack ID, generate and send
    for (const [csmName, accounts] of Object.entries(byCsm)) {
      // Skip if targeting a specific CSM
      if (targetCsm && csmName !== targetCsm) continue

      const slackId = CSM_SLACK_IDS[csmName]
      if (!slackId) {
        results.push({ csm: csmName, status: 'skipped — no Slack ID' })
        continue
      }

      try {
        // Generate personalised message with Claude
        const message = await generateMessage(csmName, accounts)

        // Send DM
        await sendDM(slackId, csmName, accounts, message)

        results.push({ csm: csmName, status: 'sent ✓' })

        // Small delay between messages to avoid rate limits
        await new Promise(r => setTimeout(r, 500))
      } catch (err: any) {
        results.push({ csm: csmName, status: 'failed', error: err.message })
      }
    }

    return NextResponse.json({
      success: true,
      date: new Date().toISOString(),
      results,
      totalSent: results.filter(r => r.status === 'sent ✓').length,
      totalFailed: results.filter(r => r.status === 'failed').length,
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
