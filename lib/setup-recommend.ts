/**
 * setup-recommend.ts
 *
 * Deterministic recommendation logic for the smart setup wizard.
 * Analyzes an AccountSnapshot and recommends the best first agent
 * based on what the data shows — no AI call needed.
 *
 * Priority waterfall:
 *   1. churn_risk     — members with dropping attendance (most common, most impactful)
 *   2. payment_recovery — payment failures detected
 *   3. win_back       — recently cancelled members worth recovering
 *   4. new_member_onboarding — new members in first 30 days
 *   5. lead_reactivation — old ghost leads (30+ days) worth re-engaging
 *   6. lead_followup  — fresh leads that haven't converted
 *   7. fallback       — generic retention monitor
 */

import type { AccountSnapshot, MemberData, PaymentEvent } from './agents/GMAgent'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SetupRecommendation {
  agentType: string
  name: string
  description: string
  headline: string        // data-driven one-liner: "3 members haven't visited in 2+ weeks"
  reasoning: string       // why this agent matters for this gym
  stats: RecommendationStat[]
  trigger: {
    mode: 'cron' | 'event'
    schedule?: string     // 'daily' | 'weekly'
    event?: string        // 'member.cancelled' etc.
  }
}

export interface RecommendationStat {
  label: string
  value: string | number
  emphasis?: boolean      // highlight this stat
}

// ── Analysis helpers ─────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface SnapshotAnalysis {
  totalMembers: number
  activeMembers: MemberData[]
  atRiskMembers: MemberData[]         // active, attendance dropped significantly
  noShowMembers: MemberData[]         // active, zero recent checkins
  cancelledMembers: MemberData[]
  recentlyCancelled: MemberData[]     // cancelled in last 30 days
  newMembers: MemberData[]            // joined last 30 days
  leads: MemberData[]                 // status === 'prospect'
  freshLeads: MemberData[]            // prospect, created within 30 days
  staleLeads: MemberData[]            // prospect, older than 30 days (ghost leads)
  paymentIssues: PaymentEvent[]
}

export function analyzeSnapshot(snapshot: AccountSnapshot, now = new Date()): SnapshotAnalysis {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString()

  const activeMembers: MemberData[] = []
  const cancelledMembers: MemberData[] = []
  const recentlyCancelled: MemberData[] = []
  const newMembers: MemberData[] = []
  const leads: MemberData[] = []
  const freshLeads: MemberData[] = []
  const staleLeads: MemberData[] = []
  const atRiskMembers: MemberData[] = []
  const noShowMembers: MemberData[] = []

  for (const m of snapshot.members) {
    if (m.status === 'prospect') {
      leads.push(m)
      // Classify by age: stale = 30+ days old, fresh = under 30 days
      if (m.memberSince && m.memberSince < thirtyDaysAgo.split('T')[0]) {
        staleLeads.push(m)
      } else {
        freshLeads.push(m)
      }
      continue
    }

    if (m.status === 'cancelled') {
      cancelledMembers.push(m)
      // "Recently cancelled" = memberSince is recent enough to still be recoverable
      // We approximate by checking if they had any recent checkins (were active recently)
      if (m.previousCheckinsCount > 0 || m.recentCheckinsCount > 0) {
        recentlyCancelled.push(m)
      }
      continue
    }

    if (m.status === 'active' || m.status === 'paused') {
      activeMembers.push(m)

      // New member: joined within 30 days
      if (m.memberSince >= thirtyDaysAgo.split('T')[0]) {
        newMembers.push(m)
      }

      // At risk: had previous checkins but recent dropped significantly
      if (m.previousCheckinsCount > 0 && m.recentCheckinsCount === 0) {
        noShowMembers.push(m)
        atRiskMembers.push(m)
      } else if (
        m.previousCheckinsCount > 2 &&
        m.recentCheckinsCount > 0 &&
        m.recentCheckinsCount <= m.previousCheckinsCount * 0.5
      ) {
        atRiskMembers.push(m)
      }
    }
  }

  return {
    totalMembers: snapshot.members.length,
    activeMembers,
    atRiskMembers,
    noShowMembers,
    cancelledMembers,
    recentlyCancelled,
    newMembers,
    leads,
    freshLeads,
    staleLeads,
    paymentIssues: snapshot.paymentEvents ?? [],
  }
}

// ── Recommendation engine ────────────────────────────────────────────────────

export function recommend(snapshot: AccountSnapshot, now = new Date()): SetupRecommendation {
  const analysis = analyzeSnapshot(snapshot, now)

  // 1. Churn risk — most common and highest value
  if (analysis.atRiskMembers.length > 0) {
    return buildChurnRiskRec(analysis)
  }

  // 2. Payment recovery
  if (analysis.paymentIssues.length > 0) {
    return buildPaymentRecoveryRec(analysis)
  }

  // 3. Win-back — recently cancelled members
  if (analysis.recentlyCancelled.length > 0) {
    return buildWinBackRec(analysis)
  }

  // 4. New member onboarding
  if (analysis.newMembers.length > 0) {
    return buildOnboardingRec(analysis)
  }

  // 5. Lead reactivation — old ghost leads that went cold
  if (analysis.staleLeads.length >= 3 || (analysis.leads.length > 0 && analysis.staleLeads.length > analysis.freshLeads.length)) {
    return buildLeadReactivationRec(analysis)
  }

  // 6. Lead follow-up — fresh leads
  if (analysis.leads.length > 0) {
    return buildLeadFollowupRec(analysis)
  }

  // 7. Fallback — generic retention monitor
  return buildFallbackRec(analysis)
}

// ── Recommendation builders ──────────────────────────────────────────────────

function buildChurnRiskRec(a: SnapshotAnalysis): SetupRecommendation {
  const noShowCount = a.noShowMembers.length
  const droppingCount = a.atRiskMembers.length - noShowCount

  let headline: string
  if (noShowCount > 0 && droppingCount > 0) {
    headline = `${noShowCount} member${noShowCount !== 1 ? 's' : ''} stopped visiting, ${droppingCount} more dropping off`
  } else if (noShowCount > 0) {
    headline = `${noShowCount} member${noShowCount !== 1 ? 's haven\'t' : ' hasn\'t'} visited in 2+ weeks`
  } else {
    headline = `${droppingCount} member${droppingCount !== 1 ? 's' : ''} with declining attendance`
  }

  const reasoning = noShowCount > 0
    ? `${noShowCount} ${noShowCount === 1 ? 'member has' : 'members have'} gone dark but haven't cancelled — you still have a window. A personal check-in catches this before it becomes a cancellation.`
    : `${a.atRiskMembers.length} ${a.atRiskMembers.length === 1 ? 'member is' : 'members are'} slipping — attendance is dropping and every week makes it harder to get them back.`

  return {
    agentType: 'at_risk_detector',
    name: 'At-Risk Monitor',
    description: 'Detect gym members whose attendance is dropping and draft personal check-in messages before they cancel.',
    headline,
    reasoning,
    stats: [
      { label: 'At Risk', value: a.atRiskMembers.length, emphasis: true },
      { label: 'Gone Dark', value: noShowCount, emphasis: noShowCount > 0 },
      { label: 'Active Members', value: a.activeMembers.length },
    ],
    trigger: { mode: 'cron', schedule: 'daily' },
  }
}

function buildPaymentRecoveryRec(a: SnapshotAnalysis): SetupRecommendation {
  return {
    agentType: 'payment_recovery',
    name: 'Payment Recovery',
    description: 'Detect failed membership payments and send friendly recovery messages before involuntary churn happens.',
    headline: `${a.paymentIssues.length} failed membership payment${a.paymentIssues.length !== 1 ? 's' : ''} need attention`,
    reasoning: `${a.paymentIssues.length} failed payment${a.paymentIssues.length !== 1 ? 's' : ''} — billing glitches, not real churn. A quick friendly heads-up and most members fix it same day.`,
    stats: [
      { label: 'Failed Payments', value: a.paymentIssues.length, emphasis: true },
      { label: 'Active Members', value: a.activeMembers.length },
    ],
    trigger: { mode: 'event', event: 'payment.failed' },
  }
}

function buildWinBackRec(a: SnapshotAnalysis): SetupRecommendation {
  return {
    agentType: 'win_back',
    name: 'Win-Back Agent',
    description: 'Reach out to recently cancelled members with a personal message to bring them back.',
    headline: `${a.recentlyCancelled.length} recently cancelled member${a.recentlyCancelled.length !== 1 ? 's' : ''} may be recoverable`,
    reasoning: `${a.recentlyCancelled.length} recent cancellation${a.recentlyCancelled.length !== 1 ? 's' : ''} — but there's a 30-day window. A personal note from the owner works where generic win-back emails don't.`,
    stats: [
      { label: 'Recent Cancellations', value: a.recentlyCancelled.length, emphasis: true },
      { label: 'Total Cancelled', value: a.cancelledMembers.length },
      { label: 'Active Members', value: a.activeMembers.length },
    ],
    trigger: { mode: 'event', event: 'member.cancelled' },
  }
}

function buildOnboardingRec(a: SnapshotAnalysis): SetupRecommendation {
  return {
    agentType: 'new_member_onboarding',
    name: 'Onboarding Coach',
    description: 'Check in on new gym members during their first 30 days to make sure they\'re settling in and building a workout routine.',
    headline: `${a.newMembers.length} new member${a.newMembers.length !== 1 ? 's' : ''} in their first 30 days`,
    reasoning: `${a.newMembers.length} new member${a.newMembers.length !== 1 ? 's' : ''} still deciding if the gym is for them. Members who don't build a habit in 30 days cancel 3x more often.`,
    stats: [
      { label: 'New Members', value: a.newMembers.length, emphasis: true },
      { label: 'Active Members', value: a.activeMembers.length },
    ],
    trigger: { mode: 'cron', schedule: 'weekly' },
  }
}

function buildLeadReactivationRec(a: SnapshotAnalysis): SetupRecommendation {
  const staleCount = a.staleLeads.length

  const ages = a.staleLeads
    .map(l => {
      if (!l.memberSince) return 0
      const d = new Date(l.memberSince)
      return isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / MS_PER_DAY)
    })
    .filter(age => age > 0)
  const maxAge = ages.length > 0 ? Math.max(...ages) : 0
  const avgAge = ages.length > 0 ? Math.round(ages.reduce((s, age) => s + age, 0) / ages.length) : 0

  const ageNote = maxAge > 180
    ? `some over ${Math.floor(maxAge / 30)} months old`
    : avgAge > 60
    ? `averaging ${Math.round(avgAge / 30)} months old`
    : 'most over a month old'

  return {
    agentType: 'lead_reactivation',
    name: 'Lead Re-Activation',
    description: 'Re-engage old leads who went cold — a personal message from the owner can bring ghost leads back into the funnel.',
    headline: `${staleCount} ghost lead${staleCount !== 1 ? 's' : ''} sitting in your system`,
    reasoning: `${staleCount} lead${staleCount !== 1 ? 's' : ''} that never converted — ${ageNote}. They raised their hand once. A personal check-in brings 10-15% of ghost leads back.`,
    stats: [
      { label: 'Ghost Leads', value: staleCount, emphasis: true },
      { label: 'Avg Age', value: `${avgAge}d`, emphasis: avgAge > 90 },
      ...(a.freshLeads.length > 0 ? [{ label: 'Fresh Leads', value: a.freshLeads.length }] : []),
      { label: 'Active Members', value: a.activeMembers.length },
    ],
    trigger: { mode: 'cron' as const, schedule: 'daily' },
  }
}

function buildLeadFollowupRec(a: SnapshotAnalysis): SetupRecommendation {
  return {
    agentType: 'lead_followup',
    name: 'Lead Follow-Up',
    description: 'Follow up with leads who haven\'t converted yet — a timely personal message makes all the difference.',
    headline: `${a.leads.length} lead${a.leads.length !== 1 ? 's' : ''} waiting for follow-up`,
    reasoning: `${a.leads.length} lead${a.leads.length !== 1 ? 's' : ''} waiting to hear from you. Same-day personal follow-up converts at 2x the rate — every day you wait, they cool off.`,
    stats: [
      { label: 'Open Leads', value: a.leads.length, emphasis: true },
      { label: 'Active Members', value: a.activeMembers.length },
    ],
    trigger: { mode: 'event', event: 'lead.created' },
  }
}

function buildFallbackRec(a: SnapshotAnalysis): SetupRecommendation {
  return {
    agentType: 'at_risk_detector',
    name: 'Retention Monitor',
    description: 'Continuously monitor gym member attendance and flag anyone who starts skipping workouts before they cancel.',
    headline: `${a.activeMembers.length} active member${a.activeMembers.length !== 1 ? 's' : ''} to watch over`,
    reasoning: `Members quit quietly — no notice, just an empty spot. A daily scan catches attendance drops before they mentally check out.`,
    stats: [
      { label: 'Active Members', value: a.activeMembers.length, emphasis: true },
      { label: 'Total Members', value: a.totalMembers },
    ],
    trigger: { mode: 'cron', schedule: 'daily' },
  }
}
