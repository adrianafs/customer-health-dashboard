/**
 * POST /api/notes       — save a note to HubSpot (v3 notes object)
 * GET  /api/notes?companyId=XXX — fetch recent notes for a company
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const HS = 'https://api.hubapi.com'
const TOKEN = process.env.HUBSPOT_TOKEN
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// HubSpot-defined association type IDs for the v3 notes object
const NOTE_TO_COMPANY = 190
const NOTE_TO_DEAL    = 214

function auth() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
}

// HubSpot stores note bodies as HTML — strip tags/entities to readable plain text,
// collapse whitespace, and cap length so the panel stays compact.
function cleanNote(html: string, maxLen = 280): string {
  const text = (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + '…' : text
}

// ── Save a note ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'HUBSPOT_TOKEN not set' }, { status: 503 })

  const { companyId, dealId, note, csmName } = await req.json() as {
    companyId: string
    dealId?: string
    note: string
    csmName: string
  }

  if (!companyId || !note?.trim()) {
    return NextResponse.json({ error: 'companyId and note are required' }, { status: 400 })
  }

  // Create a HubSpot note via the v3 CRM objects API
  const associations = [
    {
      to: { id: companyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_COMPANY }],
    },
  ]
  if (dealId && dealId !== companyId) {
    associations.push({
      to: { id: dealId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_DEAL }],
    })
  }

  const body = {
    properties: {
      hs_note_body: `[${csmName} via CS Dashboard]\n\n${note.trim()}`,
      hs_timestamp: Date.now(),
    },
    associations,
  }

  const res = await fetch(`${HS}/crm/v3/objects/notes`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[notes] HubSpot error:', err)
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({ success: true, engagementId: data.id })
}

// ── Fetch recent notes ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ notes: [] })

  const companyId = req.nextUrl.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

  // 1. Get note IDs associated to this company
  const assocRes = await fetch(
    `${HS}/crm/v3/objects/companies/${companyId}/associations/notes?limit=100`,
    { headers: auth() }
  )
  if (!assocRes.ok) return NextResponse.json({ notes: [] })

  const assocData = await assocRes.json()
  const noteIds: string[] = (assocData.results ?? []).map((r: any) => String(r.toObjectId ?? r.id)).filter(Boolean)
  if (noteIds.length === 0) return NextResponse.json({ notes: [] })

  // 2. Batch-read note bodies + timestamps
  const readRes = await fetch(`${HS}/crm/v3/objects/notes/batch/read`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({
      properties: ['hs_note_body', 'hs_timestamp', 'hs_createdate'],
      inputs: noteIds.map(id => ({ id })),
    }),
  })
  if (!readRes.ok) return NextResponse.json({ notes: [] })

  const readData = await readRes.json()
  const notes = (readData.results ?? [])
    .map((n: any) => {
      const ts = n.properties?.hs_timestamp ?? n.properties?.hs_createdate
      const ms = ts ? new Date(ts).getTime() : 0
      return {
        id: n.id,
        body: cleanNote(n.properties?.hs_note_body ?? ''),
        timestamp: ms,
        date: ms
          ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : null,
      }
    })
    .filter((n: any) => n.body)
    .sort((a: any, b: any) => b.timestamp - a.timestamp)
    .slice(0, 10)

  // 3. Summarise each note to a single concise line with Claude.
  //    Falls back to the cleaned/truncated body if no key or the call fails.
  if (process.env.ANTHROPIC_API_KEY && notes.length > 0) {
    try {
      const input = notes.map((n: any, i: number) => `[${i}] ${n.body}`).join('\n\n')
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Summarise each CRM note below into ONE short, factual sentence (max ~18 words). Keep names, dates, numbers, and action items. Drop boilerplate and formatting.\n\nReturn ONLY a JSON array like [{"i":0,"summary":"..."}] — one entry per note, same index.\n\n${input}`,
        }],
      })
      const text = resp.content.find(b => b.type === 'text')?.text ?? ''
      const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
      const summaries: { i: number; summary: string }[] = JSON.parse(json)
      for (const s of summaries) {
        if (notes[s.i] && s.summary?.trim()) notes[s.i].body = s.summary.trim()
      }
    } catch (e) {
      console.error('[notes] summary failed, using cleaned text:', e)
    }
  }

  return NextResponse.json({ notes })
}
