export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// TODO: in production, fetch real signals from HubSpot + Databricks + Chargebee before calling Claude

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a customer success scoring engine. Given signals about a B2B SaaS client, calculate a health score and classify the account. Return ONLY valid JSON, no markdown, no explanation outside the JSON.

Scoring weights:
- Platform usage (posts, approved posts, distributed posts in last 30 days): 25%
- Contract status (non_renewing=high risk, cancel_scheduled=critical, days to renewal): 25%
- Email recency and volume (days since last contact, email frequency): 20%
- Call sentiment from Fathom (positive/neutral/negative/churn language): 20%
- Financial signals (due invoices, ARR size as priority multiplier): 10%

Health states:
- stable: score 70-100, no urgent signals
- moderate: score 45-69, needs monitoring (ALL onboarding clients are moderate minimum)
- action_required: score 25-44, contact today
- churn_risk: score 0-24, save this account urgently

Return this exact JSON:
{
  "score": number,
  "healthState": "stable"|"moderate"|"action_required"|"churn_risk",
  "confidence": number,
  "whyThisScore": string,
  "recommendedAction": string,
  "scoreDrivers": [{ "label": string, "type": "positive"|"neutral"|"negative"|"critical" }]
}`

export async function POST(request: NextRequest) {
  try {
    const { client: clientData }: { client: Client } = await request.json()

    const signalsSummary = `
Client: ${clientData.name}
ARR: DKK ${clientData.arr.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
Is onboarding: ${clientData.isOnboarding ?? false}
Last contact: ${clientData.lastContactDaysAgo} days ago

HubSpot signals:
- Open tickets: ${clientData.signals.hubspot.openTickets}
- Emails last 30 days: ${clientData.signals.hubspot.emails30d}
- Emails last 90 days: ${clientData.signals.hubspot.emails90d}
- Last email inbound: ${clientData.signals.hubspot.lastEmailIn}
- Last email outbound: ${clientData.signals.hubspot.lastEmailOut}

Usage signals (Databricks):
- Posts last 30 days: ${clientData.signals.usage.posts30d}
- Approved posts: ${clientData.signals.usage.approved30d}
- Distributed posts: ${clientData.signals.usage.distributed30d}
- Rights requests: ${clientData.signals.usage.rightsRequests30d}
- Last active day: ${clientData.signals.usage.lastActiveDay ?? 'unknown'}

Subscription (Chargebee):
- Status: ${clientData.signals.chargebee.status}
- Contract end: ${clientData.signals.chargebee.contractEnd}
- Cancellation scheduled: ${clientData.signals.chargebee.cancelScheduled}
- Due invoices: ${clientData.signals.chargebee.dueInvoices}
- Total dues: DKK ${clientData.signals.chargebee.totalDues}

Call sentiment (Fathom):
${clientData.signals.fathom.sentiment ?? 'No call sentiment available'}
`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Score this client based on the following signals:\n${signalsSummary}` }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from Claude' }, { status: 500 })
    }

    const parsed = JSON.parse(textBlock.text)
    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Score API error:', error)
    return NextResponse.json({ error: 'Failed to score client' }, { status: 500 })
  }
}
