/**
 * POST /api/slack/dm
 *
 * Sends a direct message to a CSM on Slack about their at-risk accounts.
 * Uses chat.postMessage with the user's Slack User ID as the channel —
 * this delivers to the person's App Home DM, not any public channel.
 *
 * Requires:
 *   SLACK_BOT_TOKEN — Bot token with scopes: chat:write, users:read, users:read.email
 *
 * Body: { csmName: string, accounts: { name: string, state: string, arr: number, reason: string, daysToRenewal?: number | null }[] }
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN

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

async function slackPost(method: string, body: object) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function GET(req: NextRequest) {
  // Test endpoint — lists all configured CSMs
  return NextResponse.json({
    configured: Object.keys(CSM_SLACK_IDS),
    usage: 'POST with { csmName, accounts } to send a DM',
    example: {
      csmName: 'Christina Holm',
      accounts: [
        { name: 'Vero Moda', state: 'churn_risk', arr: 28000, reason: 'No contact 84d, cancel scheduled', daysToRenewal: 12 }
      ]
    }
  })
}

export async function POST(req: NextRequest) {
  if (!SLACK_TOKEN) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured.' }, { status: 503 })
  }

  const { csmName, accounts } = await req.json() as {
    csmName: string
    accounts: { name: string; state: string; arr: number; reason: string; daysToRenewal?: number | null }[]
  }

  const slackId = CSM_SLACK_IDS[csmName]
  if (!slackId) {
    return NextResponse.json({
      error: `No Slack ID configured for "${csmName}".`,
      configured: Object.keys(CSM_SLACK_IDS),
    }, { status: 404 })
  }

  // Sort: churn first, then action required
  const sorted = [...accounts].sort((a, b) => {
    const order: Record<string, number> = { churn_risk: 0, action_required: 1, keep_an_eye: 2, stable: 3 }
    return (order[a.state] ?? 9) - (order[b.state] ?? 9)
  })

  const stateEmoji: Record<string, string> = {
    churn_risk:      '🔴',
    action_required: '🟠',
    keep_an_eye:     '🟡',
    stable:          '🟢',
  }

  const stateLabel: Record<string, string> = {
    churn_risk:      'Churn Risk',
    action_required: 'Action Required',
    keep_an_eye:     'Keep an Eye',
    stable:          'Stable',
  }

  const accountLines = sorted.map(a => {
    const emoji = stateEmoji[a.state] ?? '⚪'
    const label = stateLabel[a.state] ?? a.state
    const arr   = `€${a.arr.toLocaleString('en')}`
    const ren   = a.daysToRenewal && a.daysToRenewal > 0 && a.daysToRenewal <= 90
      ? ` · renews in ${a.daysToRenewal}d` : ''
    return `${emoji} *${a.name}* (${label} · ${arr}${ren})\n  _${a.reason}_`
  }).join('\n\n')

  const urgentCount = accounts.filter(a => ['churn_risk', 'action_required'].includes(a.state)).length
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const firstName = csmName.split(' ')[0]

  const message = {
    channel: slackId,
    text: `Your CS briefing for ${today}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📋 CS Briefing — ${today}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: urgentCount > 0
            ? `Hi ${firstName}! You have *${urgentCount} account${urgentCount > 1 ? 's' : ''}* needing attention out of ${accounts.length} total.`
            : `Hi ${firstName}! All ${accounts.length} of your accounts are stable today. 🎉`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: accountLines },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📊 Open dashboard', emoji: true },
            url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://customer-health-dashboard-omega.vercel.app',
            style: 'primary',
          },
        ],
      },
    ],
  }

  const result = await slackPost('chat.postMessage', message)

  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result }, { status: 500 })
  }

  return NextResponse.json({ success: true, sentTo: csmName, slackId, messageTs: result.ts })
}
