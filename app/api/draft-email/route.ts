export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@/lib/types'
import { DraftType, DRAFT_TYPE_LABELS } from '@/lib/draftEmail'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getDraftInstruction(type: DraftType, c: Client): string {
  const d = c.signals.deal
  const ob = c.signals.onboarding

  switch (type) {
    case 'schedule_meeting':
      return `Write a very short, casual email — 2-3 sentences max. Just say you'd love to jump on a quick call to catch up and see how things are going. Keep it light and human, no corporate language, no bullet points, no long intros.`

    case 'low_usage':
      return `Write a short, casual email — no intro, they already know who you are. Mention that you've noticed they haven't been moderating content lately. Remind them that content in the inbox expires after 30 days, so it's worth checking regularly to avoid losing good content. Also mention the importance of keeping their flows updated with fresh content. End by offering help if there's anything blocking them — keep it friendly and brief, no corporate tone.`

    case 'renewal_outreach':
      return `Write a short, casual email letting the client know that their contract end date is approaching (${c.contract.renewal ?? 'soon'}) and that it's time to start the conversation about signing a new agreement. Keep it simple and friendly — just flag the date, mention you'd love to get a quick call in to kick things off, and leave it open. No corporate language.`

    case 'churn_save':
      return `Write a short, genuine email saying you'd love to connect for a quick call to understand how things are going and see if there's anything we can do to help. Keep it warm and low-pressure — no drama, no assumptions about why they might be leaving. The CSM will personalise the details themselves. Max 3-4 sentences.`

    case 'onboarding_checkin':
      return `Write a short, casual email — no intro. Just check in on how the onboarding is going, ask if there's anything blocking their progress, and offer help to move things forward. Keep it simple and friendly, 2-3 sentences max.`

    case 'reengagement_pause':
      return `Write a short, casual email — no intro. Mention that the pause is ending${c.contract.renewal ? ` on ${c.contract.renewal}` : ' soon'} and that it's time to get things moving again. Propose scheduling a call to kick off the reactivation — reconnect accounts, run a training session if needed, and align on next steps. Keep it friendly and practical.`

    case 'qbr':
      return `Write a short, casual email — no intro. Mention that you don't have the next QBR scheduled yet and you'd love to lock in a date. Explain that the goal would be to review metrics so far, follow up on any open topics or questions, and align on next steps together. Keep it friendly and to the point.`

    case 'upsell_followup':
      return `Write a short, casual email — no intro. Just ask if they've had a chance to look at the proposal or offer you sent over, and suggest getting a quick call in to go through the details together. Keep it light, 2-3 sentences max.`

    case 'account_closure':
      return `Write a clear, professional but friendly email informing the client that their account will be closed on ${d.churnDate ?? 'the agreed date'}. Let them know they should make sure to remove any Flowbox widgets from their site and download any content and analytics they want to keep before that date. Keep it factual and helpful, no drama.`
  }
}

export async function POST(request: NextRequest) {
  try {
    const { client: clientData, draftType }: { client: Client; draftType?: DraftType } = await request.json()
    const d  = clientData.signals.deal
    const co = clientData.signals.company
    const ob = clientData.signals.onboarding

    // Auto-select draft type if not provided
    const type: DraftType = draftType ?? inferDraftType(clientData)

    const context = `Client: ${clientData.name}
CSM: ${clientData.csm}
ARR: €${clientData.arr.toLocaleString()}
Health state: ${clientData.healthState}
Contract stage: ${d.stageLabel}
Renewal date: ${clientData.contract.renewal ?? 'unknown'}
Auto-renewal: ${d.autoRenewal ? 'Yes' : 'No'}
Last contact: ${clientData.lastContactDaysAgo} days ago
Service level: ${co.serviceLevel ?? 'unknown'}
Usage health: ${co.usageHealth ?? 'unknown'} (${co.totalActiveFlows} active flows)
Onboarding active: ${ob.active} (${ob.daysInOnboarding} days, stage: ${ob.stage ?? '—'})
Why this score: ${clientData.whyThisScore}
Recommended action: ${clientData.recommendedAction}`

    const instruction = getDraftInstruction(type, clientData)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You are a Customer Success Manager writing a personalized, human-sounding email to a client.
Write in English unless signals clearly suggest another language.
Never introduce yourself — the client already knows who you are.
The email should feel personal, not templated. Reference specific signals from their account when relevant.
Do not mention health scores, dashboards, or automated systems.
Keep it concise — maximum 150 words in the body.
Return ONLY valid JSON: { "subject": string, "body": string }`,
      messages: [{
        role: 'user',
        content: `${instruction}\n\nClient context:\n${context}`,
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('No response')

    const raw = textBlock.text.replace(/```json\n?|```/g, '').trim()
    const parsed = JSON.parse(raw)
    return NextResponse.json({ ...parsed, draftType: type })
  } catch (error) {
    console.error('Draft email error:', error)
    return NextResponse.json({ error: 'Failed to draft email' }, { status: 500 })
  }
}

function inferDraftType(c: Client): DraftType {
  const d  = c.signals.deal
  const ob = c.signals.onboarding

  if (c.healthState === 'churn_risk' || c.communicatedChurn) return 'churn_save'
  if (ob.active && ob.daysInOnboarding > 90)                 return 'onboarding_checkin'
  if (d.stage === '1309169017')                              return 'reengagement_pause'
  if (d.stage === '1309169014' && !d.autoRenewal)            return 'renewal_outreach'
  if (c.triggeredRules.includes('no_meeting_90d_no_next'))   return 'schedule_meeting'
  return 'schedule_meeting'
}
