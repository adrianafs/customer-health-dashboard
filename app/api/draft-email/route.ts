export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a Customer Success Manager writing a personalized, human-sounding retention email to a client.
Write in English unless signals clearly suggest another language.
The email should feel personal, not templated. Reference specific signals from their account.
Do not mention the health score or that this is an automated system.
Keep it concise — maximum 150 words in the body.
Return ONLY valid JSON: { "subject": string, "body": string }`

export async function POST(request: NextRequest) {
  try {
    const { client: clientData }: { client: Client } = await request.json()
    const d = clientData.signals.deal
    const co = clientData.signals.company

    const context = `Client: ${clientData.name}
CSM: ${clientData.csm}
ARR: €${clientData.arr.toLocaleString()}
Health state: ${clientData.healthState}
Contract stage: ${d.stageLabel}
Renewal date: ${clientData.contract.renewal ?? 'unknown'}
Last contact: ${clientData.lastContactDaysAgo} days ago
Usage health: ${co.usageHealth ?? 'unknown'} (${co.totalActiveFlows} active flows)
Auto renewal: ${d.autoRenewal}
Why this score: ${clientData.whyThisScore}
Recommended action: ${clientData.recommendedAction}
Fathom context: ${clientData.signals.fathom.summaries ?? 'No recent call data'}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a retention email for this client:\n${context}` }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('No response')

    const raw = textBlock.text.replace(/```json\n?|```/g, '').trim()
    return NextResponse.json(JSON.parse(raw))
  } catch (error) {
    console.error('Draft email error:', error)
    return NextResponse.json({ error: 'Failed to draft email' }, { status: 500 })
  }
}
