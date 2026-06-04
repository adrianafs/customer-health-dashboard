export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const today = new Date().toISOString().split('T')[0]

const SYSTEM_PROMPT = `You are a Customer Success scoring engine. Classify a SaaS client's health into exactly one of four states (in priority order):

CHURN_RISK → highest urgency
ACTION_REQUIRED
KEEP_AN_EYE
STABLE → default

Rules (first match wins):

CHURN_RISK if any:
- Deal stage is "Communicated Churn (in Winback)"
- churn_risk flag is true
- Fathom summaries contain: competitor mentions, budget cuts, ROI doubts, cancellation intent, accumulated tech problems, CSM dissatisfaction

ACTION_REQUIRED if any:
- Usage health None/zero AND inactive 40+ days
- Active discontent or platform blocking issue in Fathom
- In onboarding Implementation stage for 90+ days
- auto_renewal false AND fewer than 100 days to close date
- Stage "Up for Renewal" AND last contact 30+ days ago
- Churn date within next 15 days

KEEP_AN_EYE if any:
- Usage health Poor OR total active flows ≤ 1
- Active onboarding deal (not fully onboarded)
- Service level High AND no contact 45+ days
- Open HubSpot tasks or unresolved Fathom action items
- Stage "Renewal in Progress" or "Paused"
- Budget negotiation, upsell or proposal pending client response

STABLE: default if none of the above apply.

Today: ${today}

Return ONLY valid JSON (no markdown) with EXACTLY this shape:
{
  "status": "CHURN_RISK" | "ACTION_REQUIRED" | "KEEP_AN_EYE" | "STABLE",
  "score": 0-100,                      // overall health, higher = healthier
  "confidence": 0-100,                 // how certain you are GIVEN the data provided.
                                       // Base it on data completeness + signal agreement:
                                       // many populated, mutually-consistent signals → high (85-95);
                                       // sparse data, "unknown" fields, or conflicting signals → low (40-60).
  "reason": "one or two sentences explaining the score",
  "recommended_action": "one concrete next step for the CSM",
  "top_signals": [ { "label": "short signal", "direction": "improving" | "stable" | "declining" } ],
  "triggered_rules": [ "rule names that fired" ]
}`

export async function POST(request: NextRequest) {
  try {
    const { client: clientData, csmName }: { client: Client; csmName?: string } = await request.json()
    const d = clientData.signals.deal
    const co = clientData.signals.company
    const ob = clientData.signals.onboarding

    const userPrompt = `Client data:
- Name: ${clientData.name}
- ARR: €${clientData.arr.toLocaleString()}
- CSM: ${csmName ?? clientData.csm}
- Contract stage: ${d.stageLabel}
- Auto renewal: ${d.autoRenewal}
- Close date: ${d.closeDate ?? 'unknown'}
- Churn date: ${d.churnDate ?? 'none'}
- Last contacted: ${d.lastContactDaysAgo} days ago
- Usage health: ${co.usageHealth ?? 'unknown'}
- Total active flows: ${co.totalActiveFlows}
- Service level: ${co.serviceLevel ?? 'unknown'}
- Churn risk flag: ${co.churnRisk}
- NPS status: ${co.npsStatus ?? 'unknown'}
- In active onboarding: ${ob.active} (${ob.daysInOnboarding} days, stage: ${ob.stage ?? 'n/a'})
- Open HubSpot tasks: ${clientData.signals.openTasks}

Recent Fathom call summaries (last 90 days):
${clientData.signals.fathom.summaries ?? 'No call data available'}

Open Fathom action items assigned to CSM:
${clientData.signals.fathom.openActionItems} open items`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('No response')

    const raw = textBlock.text.replace(/```json\n?|```/g, '').trim()
    const parsed = JSON.parse(raw)

    // Normalize status to our HealthState
    const statusMap: Record<string, string> = {
      CHURN_RISK: 'churn_risk',
      ACTION_REQUIRED: 'action_required',
      KEEP_AN_EYE: 'keep_an_eye',
      STABLE: 'stable',
    }

    return NextResponse.json({
      ...parsed,
      healthState: statusMap[parsed.status] ?? 'stable',
    })
  } catch (error) {
    console.error('Score API error:', error)
    return NextResponse.json({ error: 'Failed to score client' }, { status: 500 })
  }
}
