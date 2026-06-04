export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { messages, system } = await req.json()

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system,
      messages,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    return NextResponse.json({ text })
  } catch (err) {
    console.error('[api/chat] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
