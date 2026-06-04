'use client'
import { useState, useEffect } from 'react'
import { Client, HealthState, SignalDriver, formatARR } from '@/lib/types'
import type { EngagementResult } from '@/lib/hubspot-engagements'
import type { HubSpotMeeting as MeetingData } from '@/app/api/hubspot/meetings/route'
import ScoreBar, { STATE_COLORS, STATE_LABELS } from './ScoreBar'

const DI: Record<SignalDriver['type'], string> = { positive: '↑', neutral: '~', negative: '↓', critical: '!' }
const DC: Record<SignalDriver['type'], string> = { positive: '#00CC9A', neutral: '#EAB308', negative: '#F53D52', critical: '#F53D52' }

function SRow({ k, v, cls }: { k: string; v: string | number; cls?: string }) {
  const colorMap: Record<string, string> = { ok: 'var(--s500)', wn: 'var(--w500)', bd: 'var(--d500)' }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--n500)' }}>{k}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: cls ? (colorMap[cls] ?? 'var(--n900)') : 'var(--n900)' }}>{v}</span>
    </div>
  )
}

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  COMPLETED:   { label: 'Completed',   color: 'var(--s500)' },
  SCHEDULED:   { label: 'Scheduled',   color: 'var(--v500)' },
  NO_SHOW:     { label: 'No show',     color: 'var(--d500)' },
  CANCELLED:   { label: 'Cancelled',   color: 'var(--w500)' },
  RESCHEDULED: { label: 'Rescheduled', color: 'var(--w500)' },
}

function MeetingOutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null
  const { label, color } = OUTCOME_LABELS[outcome] ?? { label: outcome, color: 'var(--n500)' }
  return (
    <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, fontWeight: 700, color, background: `${color}14`, borderRadius: 999, padding: '1px 6px' }}>
      {label}
    </span>
  )
}

interface Props { client: Client; onClose: () => void; onRescore: (c: Client) => void }

export default function DetailPanel({ client, onClose, onRescore }: Props) {
  const [drafting, setDrafting] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [emailModal, setEmailModal] = useState<{ subject: string; body: string } | null>(null)
  const [editedSubject, setEditedSubject] = useState('')
  const [editedBody, setEditedBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [engagements, setEngagements] = useState<EngagementResult | null>(null)
  const [engagementsLoading, setEngagementsLoading] = useState(false)
  const [usage, setUsage] = useState<{ lastActiveDate: string | null; activeDays30: number; flows30d: number; platformDays: number } | null>(null)
  const [meetings, setMeetings] = useState<{ lastMeeting: MeetingData | null; nextMeeting: MeetingData | null } | null>(null)
  const [meetingsLoading, setMeetingsLoading] = useState(false)

  // Load HubSpot engagement data when panel opens
  useEffect(() => {
    if (!client.companyId) return
    setEngagements(null)
    setEngagementsLoading(true)
    const params = new URLSearchParams({ id: client.companyId, name: client.name })
    fetch(`/api/engagements?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && !data.error) setEngagements(data) })
      .catch(() => {})
      .finally(() => setEngagementsLoading(false))
  }, [client.companyId, client.name])

  // Load Databricks usage data
  useEffect(() => {
    if (!client.flowboxPlatformId) return
    setUsage(null)
    fetch(`/api/usage?platformId=${client.flowboxPlatformId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && !data.error) setUsage(data) })
      .catch(() => {})
  }, [client.flowboxPlatformId])

  // Load HubSpot meetings (with outcome/status)
  useEffect(() => {
    if (!client.companyId) return
    setMeetings(null)
    setMeetingsLoading(true)
    fetch(`/api/hubspot/meetings?companyId=${client.companyId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMeetings(data) })
      .catch(() => {})
      .finally(() => setMeetingsLoading(false))
  }, [client.companyId])

  const color = STATE_COLORS[client.healthState]
  const daysToRenewal = client.contract.renewal
    ? Math.ceil((new Date(client.contract.renewal).getTime() - Date.now()) / 86400000) : null

  async function handleDraftEmail() {
    setDrafting(true)
    try {
      const res = await fetch('/api/draft-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) })
      const data = await res.json()
      setEmailModal(data); setEditedSubject(data.subject); setEditedBody(data.body); setSentTo(null)
    } catch { alert('Failed. Check ANTHROPIC_API_KEY.') }
    finally { setDrafting(false) }
  }

  async function handleRescore() {
    setRescoring(true)
    try {
      const res = await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) })
      const data = await res.json()
      const sm: Record<string, HealthState> = { stable: 'stable', keep_an_eye: 'keep_an_eye', action_required: 'action_required', churn_risk: 'churn_risk' }
      onRescore({ ...client, score: data.score ?? client.score, healthState: sm[data.healthState] ?? client.healthState, confidence: data.confidence ?? client.confidence, whyThisScore: data.reason ?? client.whyThisScore, recommendedAction: data.recommended_action ?? client.recommendedAction, scoreDrivers: (data.top_signals ?? []).map((s: { label: string; direction: string }) => ({ label: s.label, type: (s.direction === 'declining' ? 'negative' : s.direction === 'improving' ? 'positive' : 'neutral') as SignalDriver['type'], direction: s.direction as SignalDriver['direction'] })), triggeredRules: data.triggered_rules ?? client.triggeredRules })
    } catch { alert('Re-score failed.') }
    finally { setRescoring(false) }
  }

  async function handleSendEmail() {
    setSending(true)
    try {
      const res = await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: editedSubject, body: editedBody, clientName: client.name, csmName: client.csm }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSentTo(data.sentTo)
    } catch (e) { alert(String(e)) }
    finally { setSending(false) }
  }

  const d = client.signals.deal
  const co = client.signals.company
  const ob = client.signals.onboarding
  const stC: Record<string, string> = { active: 'var(--s500)', non_renewing: 'var(--d500)', in_trial: 'var(--v500)', paused: 'var(--w500)', cancelled: 'var(--d500)' }

  return (
    <>
      <div onClick={onClose} className="animate-fi" style={{ position: 'fixed', inset: 0, background: 'rgba(18,18,23,.35)', zIndex: 100, backdropFilter: 'blur(3px)' }} />

      <div className="animate-panel" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: 'var(--n0)', borderLeft: '1px solid var(--n200)', zIndex: 101, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '-16px 0 48px rgba(18,18,23,.1)' }}>
        <div style={{ height: 3, background: color, flexShrink: 0 }} />

        {/* Panel header */}
        <div style={{ height: 56, borderBottom: '1px solid var(--n100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700, color: 'var(--v500)', padding: 0, letterSpacing: '-.01em' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            All accounts
          </button>
          <a href={client.hubspotDealUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, fontFamily: 'var(--font)', fontWeight: 500, cursor: 'pointer', fontSize: 12, padding: '6px 12px', background: 'var(--n0)', color: 'var(--n900)', border: '1px solid var(--n200)', boxShadow: 'var(--ss)', textDecoration: 'none' }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M6.5 1.5H9.5V4.5M9.5 1.5L5 6M4.5 2.5H2a.5.5 0 00-.5.5v6a.5.5 0 00.5.5h6a.5.5 0 00.5-.5V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            HubSpot
          </a>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Client info */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--n100)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.1 }}>{client.name}</div>
              {daysToRenewal !== null && daysToRenewal < 60 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'var(--d50)', border: '1px solid var(--d500)', color: 'var(--d500)', flexShrink: 0 }}>
                  Renewal in {daysToRenewal}d
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--n500)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{client.csm}</span><span style={{ color: 'var(--n300)' }}>·</span>
              <span style={{ fontFamily: 'var(--mono)' }}>€{formatARR(client.arr)}/yr</span>
            </div>
            {client.childCompanies && client.childCompanies.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--n400)', letterSpacing: '.05em', textTransform: 'uppercase', marginRight: 2 }}>Brands</span>
                {client.childCompanies.map((brand, i) => (
                  <span key={i} style={{ fontSize: 11, fontWeight: 500, color: 'var(--n600)', background: 'var(--n100)', borderRadius: 6, padding: '2px 8px' }}>
                    {brand}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Score */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--n100)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, letterSpacing: '-.04em', color }}>{client.score}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'inline-flex', padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${color}14`, color }}>{STATE_LABELS[client.healthState]}</div>
                <div style={{ fontSize: 11, color: 'var(--n500)' }}>Confidence {client.confidence}%</div>
              </div>
            </div>
            <ScoreBar score={client.score} healthState={client.healthState} height={5} />
          </div>

          {/* Why this score */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--n100)' }}>
            <div style={{ background: 'linear-gradient(135deg,rgba(106,0,255,.04),rgba(106,0,255,.02))', border: '1px solid var(--v100)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--v600)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Why this score</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--v600)', background: 'var(--v100)', borderRadius: 999, padding: '2px 8px' }}>CONF {client.confidence}%</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--n800)', lineHeight: 1.7, marginBottom: 12 }}>{client.whyThisScore}</p>
              <div style={{ background: 'rgba(106,0,255,.07)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--v500)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Recommended action</div>
                <div style={{ fontSize: 12, color: 'var(--v700)', lineHeight: 1.6 }}>{client.recommendedAction}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {client.scoreDrivers.map((dr, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: 'var(--n800)' }}>
                    <span style={{ color: DC[dr.type], fontWeight: 800, width: 10, flexShrink: 0, fontSize: 12 }}>{DI[dr.type]}</span>
                    {dr.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Signals */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--n100)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n500)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Signals</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { title: 'Deal', src: 'HUBSPOT', rows: [
                  { k: 'Stage', v: d.stageLabel, cls: d.stage === '1309169016' ? 'bd' : undefined },
                  { k: 'Sub. end date', v: d.closeDate ?? '—', cls: daysToRenewal !== null && daysToRenewal < 60 ? 'bd' : undefined },
                  { k: 'Last contact', v: `${d.lastContactDaysAgo}d ago`, cls: d.lastContactDaysAgo > 30 ? 'bd' : d.lastContactDaysAgo > 14 ? 'wn' : 'ok' },
                ]},
                { title: 'Company', src: 'HUBSPOT', rows: [
                  { k: 'Service level', v: co.serviceLevel ?? '—' },
                  { k: 'NPS status', v: co.npsStatus ?? '—' },
                ]},
                { title: 'Platform usage', src: 'DATABRICKS', rows: [
                  { k: 'Activity (30d)', v: !client.flowboxPlatformId ? 'No platform ID' : usage ? (usage.activeDays30 > 0 ? `${usage.activeDays30} active days` : 'No activity') : '…', cls: usage ? (usage.activeDays30 === 0 ? 'bd' : usage.activeDays30 < 5 ? 'wn' : 'ok') : undefined },
                  { k: 'Flows distributed (30d)', v: !client.flowboxPlatformId ? '—' : usage ? usage.flows30d : '…', cls: usage ? (usage.flows30d === 0 ? 'bd' : usage.flows30d < 10 ? 'wn' : 'ok') : undefined },
                  { k: 'Last active', v: !client.flowboxPlatformId ? '—' : usage?.lastActiveDate ?? '…', cls: usage ? (usage.platformDays > 60 ? 'bd' : usage.platformDays > 30 ? 'wn' : 'ok') : undefined },
                ]},
                ...(ob.active ? [{ title: 'Onboarding', src: 'HUBSPOT', rows: [
                  { k: 'Days in OB', v: ob.daysInOnboarding, cls: ob.daysInOnboarding > 90 ? 'bd' : undefined },
                  { k: 'Stage', v: ob.stage ?? '—' },
                  { k: 'Open tasks', v: client.signals.openTasks, cls: client.signals.openTasks > 0 ? 'wn' : undefined },
                ]}] : []),
              ].map(sc => (
                <div key={sc.title} style={{ background: 'var(--n50)', border: '1px solid var(--n100)', borderRadius: 12, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{sc.title}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', color: sc.src === 'DATABRICKS' ? 'var(--v500)' : 'var(--n400)' }}>{sc.src}</span>
                  </div>
                  {sc.rows?.map((r, i) => <SRow key={i} k={r.k} v={r.v as string} cls={r.cls} />)}
                </div>
              ))}
              {/* Meetings — last + next */}
              <div style={{ background: 'var(--n50)', border: '1px solid var(--n100)', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Meetings</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--n400)', letterSpacing: '.07em' }}>HUBSPOT</span>
                </div>
                {meetingsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--n400)', fontSize: 11.5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                    </svg>
                    Loading…
                  </div>
                ) : meetings ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {meetings.lastMeeting ? (
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--n400)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 2 }}>Last meeting</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n900)' }}>{meetings.lastMeeting.date}</div>
                        {meetings.lastMeeting.title && (
                          <div style={{ fontSize: 10.5, color: 'var(--n600)', marginTop: 1 }}>{meetings.lastMeeting.title}</div>
                        )}
                        <MeetingOutcomeBadge outcome={meetings.lastMeeting.outcome} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--n400)', fontStyle: 'italic' }}>No past meetings</span>
                    )}
                    <div style={{ height: 1, background: 'var(--n100)' }} />
                    {meetings.nextMeeting ? (
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--v500)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 2 }}>Next meeting</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n900)' }}>{meetings.nextMeeting.date}</div>
                        {meetings.nextMeeting.title && (
                          <div style={{ fontSize: 10.5, color: 'var(--n600)', marginTop: 1 }}>{meetings.nextMeeting.title}</div>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--n400)', fontStyle: 'italic' }}>No upcoming meetings</span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--n400)', fontStyle: 'italic' }}>Unavailable</span>
                )}
              </div>

              {/* HubSpot Activity — live sentiment */}
              <div style={{ background: 'var(--n50)', border: '1px solid var(--n100)', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Activity</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--n400)', letterSpacing: '.07em' }}>AI SENTIMENT</span>
                </div>

                {engagementsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', color: 'var(--n400)', fontSize: 11.5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                    </svg>
                    Analysing activity…
                  </div>
                ) : engagements && engagements.activityCount > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Sentiment sentence */}
                    {engagements.sentiment && (
                      <div style={{
                        fontSize: 11.5, lineHeight: 1.6, fontStyle: 'italic',
                        color: engagements.sentimentType === 'churn' || engagements.sentimentType === 'negative'
                          ? 'var(--d500)'
                          : engagements.sentimentType === 'positive' ? 'var(--s500)' : 'var(--n700)',
                      }}>
                        &ldquo;{engagements.sentiment}&rdquo;
                      </div>
                    )}
                    {/* Stats */}
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--n500)' }}>
                        <strong style={{ color: 'var(--n800)' }}>{engagements.activityCount}</strong> activities in 6mo
                      </span>
                      {engagements.lastActivityDate && (
                        <span style={{ fontSize: 11, color: 'var(--n500)' }}>
                          Last: <strong style={{ color: 'var(--n800)' }}>{engagements.lastActivityDate}</strong>
                        </span>
                      )}
                      {engagements.openActionItems.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--w500)', fontWeight: 600 }}>
                          {engagements.openActionItems.length} pending action{engagements.openActionItems.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {/* Open action items */}
                    {engagements.openActionItems.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {engagements.openActionItems.map((item, i) => (
                          <div key={i} style={{ fontSize: 10.5, color: 'var(--n600)', display: 'flex', gap: 4 }}>
                            <span style={{ color: 'var(--w500)', flexShrink: 0 }}>•</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Activity type breakdown */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(['EMAIL', 'MEETING', 'CALL', 'NOTE'] as const).map(type => {
                        const count = engagements.engagements.filter(e => e.type === type).length
                        if (!count) return null
                        const labels = { EMAIL: '✉', MEETING: '📅', CALL: '📞', NOTE: '📝' }
                        return (
                          <span key={type} style={{ fontSize: 10, padding: '2px 7px', background: 'var(--n100)', color: 'var(--n600)', borderRadius: 5, fontWeight: 500 }}>
                            {labels[type]} {count} {type.toLowerCase()}{count !== 1 ? 's' : ''}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ) : engagements && engagements.activityCount === 0 ? (
                  <span style={{ fontSize: 11.5, color: 'var(--n400)', fontStyle: 'italic' }}>No activity found in the last 90 days</span>
                ) : (
                  <span style={{ fontSize: 11.5, color: 'var(--n400)', fontStyle: 'italic' }}>Activity data unavailable</span>
                )}
              </div>
            </div>
          </div>

          {/* Contract */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--n100)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n500)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Contract</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {([
                { l: 'Start', v: client.contract.start ?? '—', danger: false },
                { l: 'End', v: client.contract.renewal ?? '—', danger: daysToRenewal !== null && daysToRenewal < 60 },
                { l: 'Auto-renewal', v: d.autoRenewal ? 'Yes ✓' : 'No', danger: false, ok: d.autoRenewal },
                { l: 'Notice period', v: client.contract.noticePeriodMonths ? `${client.contract.noticePeriodMonths}mo` : '—', danger: false },
              ] as { l: string; v: string; danger: boolean; ok?: boolean }[]).map(c => (
                <div key={c.l} style={{ background: 'var(--n50)', border: '1px solid var(--n100)', borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{c.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.danger ? 'var(--d500)' : c.ok === false ? 'var(--w500)' : c.ok ? 'var(--s500)' : 'var(--n900)' }}>{c.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: '18px 20px 28px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--n500)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Actions</div>
            <button onClick={handleDraftEmail} disabled={drafting}
              style={{ width: '100%', padding: '11px 16px', borderRadius: 8, background: 'var(--v500)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8, boxShadow: 'var(--sv)', letterSpacing: '-.01em', opacity: drafting ? .6 : 1 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8.5" rx="1.5" stroke="white" strokeWidth="1.3"/><path d="M1.5 5.5l5 3 5-3" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>
              {drafting ? 'Drafting…' : 'Draft & send retention email'}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <a href={client.hubspotDealUrl} target="_blank" rel="noopener noreferrer"
                style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--n50)', color: 'var(--n900)', border: '1px solid var(--n200)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}>
                ↗ Open in HubSpot
              </a>
              <button onClick={handleRescore} disabled={rescoring}
                style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--n50)', color: 'var(--n900)', border: '1px solid var(--n200)', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: rescoring ? .6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {rescoring ? <span className="animate-spin-cls">↻</span> : '↻'} Re-score
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Email modal */}
      {emailModal && (
        <>
          <div onClick={() => { setEmailModal(null); setSentTo(null) }} className="animate-fi" style={{ position: 'fixed', inset: 0, background: 'rgba(7,15,34,.65)', zIndex: 200, backdropFilter: 'blur(5px)' }} />
          <div className="animate-modal" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(640px,95vw)', maxHeight: '90vh', background: 'var(--n0)', borderRadius: 16, zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px -12px rgba(18,18,23,.25)' }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,var(--v500),var(--v300))`, flexShrink: 0 }} />
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--n100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="4" width="14" height="10" rx="2" stroke={color} strokeWidth="1.4"/><path d="M2 6.5l7 4.5 7-4.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.02em' }}>Draft retention email</div>
                  <div style={{ fontSize: 12, color: 'var(--n500)', marginTop: 1 }}>{client.name} · from {client.csm}</div>
                </div>
              </div>
              <button onClick={() => { setEmailModal(null); setSentTo(null) }} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--n200)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--n500)' }}>×</button>
            </div>

            {sentTo ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 32px', gap: 16, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--s50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 7L9 16l-5-5" stroke="var(--s500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 5 }}>Draft sent to your inbox</div>
                  <div style={{ fontSize: 13, color: 'var(--n500)', lineHeight: 1.6 }}>Sent to <strong>{sentTo}</strong>.<br/>Review, then copy-paste to send to {client.name}.</div>
                </div>
                <div style={{ marginTop: 8, padding: '10px 18px', background: 'var(--v50)', border: '1px solid var(--v100)', borderRadius: 8, fontSize: 12, color: 'var(--v600)' }}>
                  Check your inbox at {sentTo}
                </div>
                <button onClick={() => { setEmailModal(null); setSentTo(null) }}
                  style={{ marginTop: 8, padding: '10px 24px', borderRadius: 8, background: 'var(--v500)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--sv)' }}>Done</button>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'var(--v50)', border: '1px solid var(--v100)', fontSize: 10, fontWeight: 700, color: 'var(--v600)', letterSpacing: '.05em', marginBottom: 16 }}>
                    ✦ AI-drafted · review before sending
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--s50)', border: '1px solid #00CC9A40', fontSize: 12, color: 'var(--s600)', marginBottom: 16, display: 'flex', gap: 8 }}>
                    <span>→</span>
                    <span>Will be sent to <strong>your {client.csm.split(' ')[0].toLowerCase()}@getflowbox.com inbox</strong> — not to the client</span>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n700)', marginBottom: 5, letterSpacing: '.02em' }}>Subject</div>
                    <input value={editedSubject} onChange={e => setEditedSubject(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--n200)', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--n900)', background: 'var(--n0)', outline: 'none' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n700)', marginBottom: 5, letterSpacing: '.02em' }}>Body</div>
                    <textarea value={editedBody} onChange={e => setEditedBody(e.target.value)} rows={10}
                      style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--n200)', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--n900)', background: 'var(--n0)', outline: 'none', resize: 'vertical', lineHeight: 1.7 }} />
                  </div>
                </div>
                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--n100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--n50)', flexShrink: 0 }}>
                  <button onClick={() => navigator.clipboard.writeText(`Subject: ${editedSubject}\n\n${editedBody}`)}
                    style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--n200)', background: 'var(--n0)', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: 'var(--n500)', fontFamily: 'var(--font)' }}>
                    Copy
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEmailModal(null); setSentTo(null) }}
                      style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--n200)', background: 'var(--n0)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--n900)', fontFamily: 'var(--font)' }}>Cancel</button>
                    <button onClick={handleSendEmail} disabled={sending}
                      style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--v500)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--sv)', opacity: sending ? .6 : 1, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font)' }}>
                      {sending ? <span className="animate-spin-cls">↻</span> : '✉'} {sending ? 'Sending…' : 'Send to my inbox'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
