export const dynamic = 'force-dynamic'

// TODO: in production, enrich with full HubSpot email history before drafting

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a Customer Success Manager writing a retention email. Write a personalized, warm, professional email based on the client's health signals. Do NOT make it sound automated. Reference specific signals (usage drop, open ticket, renewal date, etc). Keep it under 200 words. Return ONLY valid JSON: { "subject": string, "body": string }`

export async function POST(request: NextRequest) {
  try {
    const { client: clientData }: { client: Client } = await request.json()

    const context = `
Client name: ${clientData.name}
Health state: ${clientData.healthState}
Score: ${clientData.score}
ARR: DKK ${clientData.arr.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
CSM: ${clientData.csm}
Last contact: ${clientData.lastContactDaysAgo} days ago
Contract renewal: ${clientData.contract.renewal}
Days since active: ${clientData.signals.usage.lastActiveDay ? 'active recently' : 'no recent activity'}
Posts last 30d: ${clientData.signals.usage.posts30d}
Open tickets: ${clientData.signals.hubspot.openTickets}
Cancellation scheduled: ${clientData.signals.chargebee.cancelScheduled}
Fathom sentiment: ${clientData.signals.fathom.sentiment ?? 'none'}
Why this score: ${clientData.whyThisScore}
Recommended action: ${clientData.recommendedAction}
`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a retention email for this client:\n${context}` }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from Claude' }, { status: 500 })
    }

    const parsed = JSON.parse(textBlock.text)
    return NextResponse.json(parsed)
  } catch (error) {
    console.error('Draft email API error:', error)
    return NextResponse.json({ error: 'Failed to draft email' }, { status: 500 })
  }
}
