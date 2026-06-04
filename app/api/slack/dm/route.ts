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
 * To get Slack User IDs:
 *   Visit /api/slack/dm?lookup=email&email=christina.holm@getflowbox.com
 *   This will return the Slack User ID for that email — add it to CSM_SLACK_IDS below.
 *
 * Body: { csmName: string, accounts: { name: string, state: string, arr: number, reason: string }[] }
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN

// ─── Map CSM names to their Slack User IDs ───────────────────────────────────
// To find a Slack User ID: visit /api/slack/dm?lookup=email&email=their@email.com
// Or in Slack: click their profile → ··· → Copy member ID
const CSM_SLACK_IDS: Record<string, string> = {
  // Add your CSMs here — format: 'Full Name': 'UXXXXXXXXXX'
  // 'Christina Holm':          'U0XXXXXXXX',
  // 'Claudia Núñez':           'U0XXXXXXXX',
  // 'Cecile Gautier':          'U0XXXXXXXX',
  // 'Sophia Jonsson':          'U0XXXXXXXX',
  // 'Chantal van den Berg':    'U0XXXXXXXX',
  // 'Frida Lindqvist':         'U0XXXXXXXX',
  // 'Oktawia Gardecka':        'U0XXXXXXXX',
  // 'Jana Khoraizat':          'U0XXXXXXXX',
  // 'Jerry de Waart':          'U0XXXXXXXX',
  // 'Analicia Montealegre':    'U0XXXXXXXX',
  // 'Sandra Vinsa':            'U0XXXXXXXX',
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

// Look up a Slack User ID by email
async function lookupByEmail(email: string): Promise<{ id: string; name: string } | null> {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { 'Authorization': `Bearer ${SLACK_TOKEN}` },
  })
  const data = await res.json()
  if (!data.ok || !data.user) return null
  return { id: data.user.id, name: data.user.real_name }
}

export async function GET(req: NextRequest) {
  // Helper endpoint: look up a Slack ID by email
  // Usage: /api/slack/dm?lookup=email&email=someone@getflowbox.com
  const lookup = req.nextUrl.searchParams.get('lookup')
  const email  = req.nextUrl.searchParams.get('email')

  if (lookup === 'email' && email) {
    if (!SLACK_TOKEN) return NextResponse.json({ error: 'SLACK_BOT_TOKEN not set' }, { status: 503 })
    const user = await lookupByEmail(email)
    if (!user) return NextResponse.json({ error: `No Slack user found for ${email}` }, { status: 404 })
    return NextResponse.json({
      slackId: user.id,
      name: user.name,
      hint: `Add to CSM_SLACK_IDS: '${user.name}': '${user.id}'`,
    })
  }

  return NextResponse.json({ usage: 'POST with { csmName, accounts } to send a DM. GET with ?lookup=email&email=x to find a Slack ID.' })
}

export async function POST(req: NextRequest) {
  if (!SLACK_TOKEN) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured. Add it to Vercel environment variables.' }, { status: 503 })
  }

  const { csmName, accounts } = await req.json() as {
    csmName: string
    accounts: { name: string; state: string; arr: number; reason: string; daysToRenewal?: number | null }[]
  }

  const slackId = CSM_SLACK_IDS[csmName]
  if (!slackId) {
    return NextResponse.json({
      error: `No Slack ID configured for ${csmName}. Add it to CSM_SLACK_IDS in /api/slack/dm/route.ts`,
      hint: `Visit /api/slack/dm?lookup=email&email=${csmName.toLowerCase().replace(' ', '.')}@getflowbox.com to find their Slack ID`,
    }, { status: 404 })
  }

  // Sort accounts: churn first, then action_required
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

  const message = {
    channel: slackId,
    text: `Your CS briefing for ${today}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📋 Your CS briefing — ${today}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: urgentCount > 0
            ? `You have *${urgentCount} account${urgentCount > 1 ? 's' : ''}* needing immediate attention out of ${accounts.length} total.`
            : `All ${accounts.length} accounts are stable. Great work! 🎉`,
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
            text: { type: 'plain_text', text: 'Open dashboard', emoji: true },
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

  return NextResponse.json({ success: true, messageTs: result.ts, channel: result.channel })
}
