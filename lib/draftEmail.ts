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
