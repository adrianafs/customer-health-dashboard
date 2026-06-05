export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@/lib/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type DraftType =
  | 'schedule_meeting'
  | 'low_usage'
  | 'renewal_outreach'
  | 'meeting_followup'
  | 'churn_save'
  | 'onboarding_checkin'
  | 'reengagement_pause'
  | 'qbr'
  | 'upsell_followup'

export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  schedule_meeting:   'Schedule a meeting',
  low_usage:          'Low / no usage',
  renewal_outreach:   'Renewal outreach',
  meeting_followup:   'Meeting follow-up',
  churn_save:         'Churn save play',
  onboarding_checkin: 'Onboarding check-in',
  reengagement_pause: 'Re-engagement (paused)',
  qbr:                'QBR / Business review',
  upsell_followup:    'Upsell / proposal follow-up',
}

function getDraftInstruction(type: DraftType, c: Client): string {
  const d = c.signals.deal
  const ob = c.signals.onboarding

  switch (type) {
    case 'schedule_meeting':
      return `The CSM has not had a completed meeting with this client in over 90 days and there is no next meeting scheduled. Write a short, friendly email to re-establish contact and propose booking a call. Don't be pushy — frame it as a regular check-in to see how things are going and share any updates.`

    case 'low_usage':
      return `This client has very low or zero platform activity recently. Write an email offering to help them get more value out of Flowbox. Acknowledge that things get busy, offer a quick call to review their setup, share tips or a success story relevant to their industry. Be helpful, not accusatory.`

    case 'renewal_outreach':
      return `The client's contract is up for renewal (renewal date: ${c.contract.renewal ?? 'soon'}) and auto-renewal is off. Write an email to open the renewal conversation. Reference the value they've gotten, express enthusiasm about continuing the partnership, and propose a call to discuss next steps.`

    case 'meeting_followup':
      return `Write a follow-up email after a recent meeting. Thank them for their time, summarise the key points discussed (use the context below as a guide), confirm any action items, and set clear next steps.`

    case 'churn_save':
      return `This client is at risk of churning${c.communicatedChurn ? ' and has communicated churn intent' : ''}. ${d.reasonForChurn ? `Stated reason: ${d.reasonForChurn}.` : ''} Write a genuine, empathetic save-play email. Acknowledge their concerns, offer concrete solutions or alternatives, and propose an urgent call with a senior CSM or decision-maker. Do not be defensive.`

    case 'onboarding_checkin':
      return `This client has been in onboarding for ${ob.daysInOnboarding} days (stage: ${ob.stage ?? 'unknown'}) and progress seems slow. Write a proactive check-in email. Express that you want to make sure they're on track, offer additional support, and propose a call to unblock any issues or review the implementation plan.`

    case 'reengagement_pause':
      return `The client's contract is currently paused${c.contract.renewal ? ` and is set to resume around ${c.contract.renewal}` : ''}. Write a warm re-engagement email ahead of the pause ending. Check in on how things are going, express excitement about restarting, and offer support to make the comeback smooth.`

    case 'qbr':
      return `This client is healthy and stable but hasn't had a formal business review recently and has no next meeting scheduled. Write an email proposing a Quarterly Business Review (QBR). Frame it as an opportunity to review results, share the roadmap, and plan for the next quarter together. Keep it light and easy to say yes to.`

    case 'upsell_followup':
      return `A proposal or upsell offer (new contract, additional features, or expanded service) has been sent to this client. Write a polite follow-up email to check if they've had a chance to review it, offer to answer any questions, and propose a call to discuss. Don't be pushy — keep it conversational.`
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
