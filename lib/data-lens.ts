/**
 * data-lens.ts — Connector-backed, refreshable data memories.
 *
 * A "data lens" is a named summary of connector data that persists between
 * agent runs. Instead of dumping raw JSON into prompts, the harvest step
 * segments data and produces human-readable summaries stored as memories.
 *
 * Flow:
 *   1. Connector fetches raw data (AccountSnapshot)
 *   2. harvestDataLenses() segments and summarizes into lens memories
 *   3. Agent prompt building injects lens memories via getMemoriesForPrompt()
 *   4. Stale lenses are refreshed before agent runs
 *
 * The lens definitions are NOT hardcoded domain logic. They segment by
 * member status (infrastructure) and let the AI summarize (domain reasoning).
 * New skill files don't require new lens code — the summaries are generic.
 */

import { supabaseAdmin } from './supabase'
import type { AccountSnapshot } from './agents/GMAgent'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataLens {
  /** Unique lens name per account */
  name: string
  /** Human-readable summary for the agent prompt */
  content: string
  /** Structured backing data (counts, IDs, etc.) */
  snapshot: LensSnapshot
  /** Memory scope for contextual recall */
  scope: string
  /** How long before this lens is stale */
  staleAfter: string
}

export interface LensSnapshot {
  count: number
  ids: string[]
  segments?: Record<string, number>
  computed_at: string
  [key: string]: unknown
}

interface LensMember {
  id: string
  name: string
  email: string
  status: string
  memberSince: string
  monthlyRevenue: number
  daysSinceLastVisit: number | null
}

// ── Harvest: Snapshot → Data Lens Memories ───────────────────────────────────

/**
 * Segment an AccountSnapshot into data lens memories and upsert them.
 *
 * This is the "harvest" step — called after buildAccountSnapshot() during
 * an agent run. Each lens is a focused summary that replaces raw JSON dumps.
 *
 * Segmentation is by member status (infrastructure), not domain logic.
 * The content summaries are descriptive facts, not domain decisions.
 */
export async function harvestDataLenses(
  accountId: string,
  snapshot: AccountSnapshot,
): Promise<DataLens[]> {
  const now = new Date()
  const lenses: DataLens[] = []

  // Segment members by status
  const active: LensMember[] = []
  const exMembers: LensMember[] = []
  const prospects: LensMember[] = []
  const paused: LensMember[] = []

  for (const m of snapshot.members) {
    const daysSince = m.lastCheckinAt
      ? Math.floor((now.getTime() - new Date(m.lastCheckinAt).getTime()) / 86_400_000)
      : null
    const entry: LensMember = {
      id: m.id,
      name: m.name,
      email: m.email,
      status: m.status,
      memberSince: m.memberSince,
      monthlyRevenue: m.monthlyRevenue,
      daysSinceLastVisit: daysSince,
    }

    switch (m.status) {
      case 'prospect': prospects.push(entry); break
      case 'cancelled': exMembers.push(entry); break
      case 'paused': paused.push(entry); break
      default: active.push(entry); break
    }
  }

  // Merge recentLeads into prospects (dedup by ID)
  const prospectIds = new Set(prospects.map(p => p.id))
  for (const l of snapshot.recentLeads) {
    if (!prospectIds.has(l.id)) {
      prospects.push({
        id: l.id, name: l.name, email: l.email, status: 'prospect',
        memberSince: l.createdAt, monthlyRevenue: 0, daysSinceLastVisit: null,
      })
    }
  }

  // ── Ghost Leads lens ────────────────────────────────────────────────────

  if (prospects.length > 0) {
    const ageBuckets = bucketByAge(prospects, now)
    const oldestDays = Math.max(...prospects.map(p => daysSinceDateStr(p.memberSince, now)))
    const withEmail = prospects.filter(p => p.email)

    lenses.push({
      name: 'ghost_leads',
      scope: 'sales',
      staleAfter: '12 hours',
      content: [
        `${prospects.length} prospect${s(prospects.length)} that never converted to members.`,
        ageBuckets.old > 0 ? `${ageBuckets.old} high-priority (90+ days old).` : null,
        ageBuckets.mid > 0 ? `${ageBuckets.mid} medium-priority (30-90 days).` : null,
        ageBuckets.recent > 0 ? `${ageBuckets.recent} recent (under 30 days, handled by lead followup).` : null,
        `${withEmail.length} have email addresses (reachable).`,
        oldestDays > 0 ? `Oldest lead: ${oldestDays} days.` : null,
      ].filter(Boolean).join(' '),
      snapshot: {
        count: prospects.length,
        ids: prospects.map(p => p.id),
        segments: ageBuckets,
        reachable: withEmail.length,
        oldest_days: oldestDays,
        computed_at: now.toISOString(),
      },
    })
  }

  // ── Ex-Members lens ─────────────────────────────────────────────────────

  if (exMembers.length > 0) {
    const ageBuckets = bucketByAge(exMembers, now)
    const withRevenue = exMembers.filter(m => m.monthlyRevenue > 0)
    const totalLostRevenue = withRevenue.reduce((sum, m) => sum + m.monthlyRevenue, 0)

    lenses.push({
      name: 'ex_members',
      scope: 'retention',
      staleAfter: '12 hours',
      content: [
        `${exMembers.length} ex-member${s(exMembers.length)} (cancelled).`,
        ageBuckets.recent > 0 ? `${ageBuckets.recent} cancelled recently (under 30 days, win-back candidates).` : null,
        ageBuckets.mid > 0 ? `${ageBuckets.mid} cancelled 30-90 days ago.` : null,
        ageBuckets.old > 0 ? `${ageBuckets.old} cancelled 90+ days ago (reactivation targets).` : null,
        totalLostRevenue > 0 ? `Combined lost revenue: $${totalLostRevenue}/mo.` : null,
      ].filter(Boolean).join(' '),
      snapshot: {
        count: exMembers.length,
        ids: exMembers.map(m => m.id),
        segments: ageBuckets,
        lost_revenue_monthly: totalLostRevenue,
        computed_at: now.toISOString(),
      },
    })
  }

  // ── Active At-Risk lens ─────────────────────────────────────────────────

  const atRisk = active.filter(m =>
    m.daysSinceLastVisit !== null && m.daysSinceLastVisit >= 14
  )

  if (atRisk.length > 0) {
    const critical = atRisk.filter(m => m.daysSinceLastVisit! >= 30)
    const high = atRisk.filter(m => m.daysSinceLastVisit! >= 21 && m.daysSinceLastVisit! < 30)
    const medium = atRisk.filter(m => m.daysSinceLastVisit! >= 14 && m.daysSinceLastVisit! < 21)
    const revenueAtRisk = atRisk.reduce((sum, m) => sum + m.monthlyRevenue, 0)

    lenses.push({
      name: 'active_at_risk',
      scope: 'retention',
      staleAfter: '6 hours',
      content: [
        `${atRisk.length} active member${s(atRisk.length)} showing signs of disengagement.`,
        critical.length > 0 ? `${critical.length} critical (30+ days absent).` : null,
        high.length > 0 ? `${high.length} high (21-29 days absent).` : null,
        medium.length > 0 ? `${medium.length} medium (14-20 days absent).` : null,
        revenueAtRisk > 0 ? `$${revenueAtRisk}/mo revenue at risk.` : null,
      ].filter(Boolean).join(' '),
      snapshot: {
        count: atRisk.length,
        ids: atRisk.map(m => m.id),
        segments: { critical: critical.length, high: high.length, medium: medium.length },
        revenue_at_risk: revenueAtRisk,
        computed_at: now.toISOString(),
      },
    })
  }

  // ── Payment Issues lens ─────────────────────────────────────────────────

  const failedPayments = snapshot.paymentEvents.filter(p => p.eventType === 'payment_failed')
  if (failedPayments.length > 0) {
    const totalAmount = failedPayments.reduce((sum, p) => sum + p.amount, 0)

    lenses.push({
      name: 'payment_issues',
      scope: 'retention',
      staleAfter: '6 hours',
      content: [
        `${failedPayments.length} member${s(failedPayments.length)} with failed payments.`,
        totalAmount > 0 ? `Total: $${totalAmount} in failed charges.` : null,
      ].filter(Boolean).join(' '),
      snapshot: {
        count: failedPayments.length,
        ids: failedPayments.map(p => p.memberId),
        total_amount: totalAmount,
        computed_at: now.toISOString(),
      },
    })
  }

  // ── Business Overview lens (always created) ─────────────────────────────

  const totalRevenue = active.reduce((sum, m) => sum + m.monthlyRevenue, 0)

  lenses.push({
    name: 'business_overview',
    scope: 'global',
    staleAfter: '24 hours',
    content: [
      `${active.length} active member${s(active.length)}.`,
      paused.length > 0 ? `${paused.length} paused.` : null,
      exMembers.length > 0 ? `${exMembers.length} ex-members.` : null,
      prospects.length > 0 ? `${prospects.length} unconverted prospects.` : null,
      totalRevenue > 0 ? `Active monthly revenue: $${totalRevenue}.` : null,
    ].filter(Boolean).join(' '),
    snapshot: {
      count: active.length + paused.length + exMembers.length + prospects.length,
      ids: [],
      segments: {
        active: active.length,
        paused: paused.length,
        ex_members: exMembers.length,
        prospects: prospects.length,
      },
      active_revenue: totalRevenue,
      computed_at: now.toISOString(),
    },
  })

  // ── Persist all lenses ──────────────────────────────────────────────────

  await upsertLenses(accountId, lenses)

  return lenses
}

// ── Staleness Check ──────────────────────────────────────────────────────────

/**
 * Check if any data lens memories are stale for an account.
 * Returns lens names that need refresh.
 */
export async function getStaleLenses(accountId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('memories')
    .select('data_lens, refreshed_at, stale_after')
    .eq('account_id', accountId)
    .eq('active', true)
    .not('data_lens', 'is', null)

  if (error || !data) return []

  const now = new Date()
  const stale: string[] = []

  for (const row of data) {
    if (!row.refreshed_at || !row.stale_after) {
      stale.push(row.data_lens)
      continue
    }

    // Parse interval string (e.g. "6 hours", "12 hours", "24 hours")
    const refreshedAt = new Date(row.refreshed_at)
    const staleMs = parseIntervalMs(row.stale_after)
    if (now.getTime() - refreshedAt.getTime() > staleMs) {
      stale.push(row.data_lens)
    }
  }

  return stale
}

// ── DB Operations ────────────────────────────────────────────────────────────

async function upsertLenses(accountId: string, lenses: DataLens[]): Promise<void> {
  const now = new Date().toISOString()

  for (const lens of lenses) {
    // Try to find existing lens
    const { data: existing } = await supabaseAdmin
      .from('memories')
      .select('id')
      .eq('account_id', accountId)
      .eq('data_lens', lens.name)
      .eq('active', true)
      .maybeSingle()

    if (existing) {
      // Update in place
      await supabaseAdmin
        .from('memories')
        .update({
          content: lens.content,
          data_snapshot: lens.snapshot,
          refreshed_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)
    } else {
      // Insert new lens memory
      await supabaseAdmin
        .from('memories')
        .insert({
          account_id: accountId,
          category: 'data_lens',
          content: lens.content,
          importance: 4, // High importance — always include in prompts
          scope: lens.scope,
          source: 'system',
          data_lens: lens.name,
          data_source: { connector: 'pushpress', segment: lens.name },
          data_snapshot: lens.snapshot,
          refreshed_at: now,
          stale_after: lens.staleAfter,
        })
    }
  }

  // Deactivate lenses that no longer have data (e.g., all payment issues resolved)
  const activeLensNames = lenses.map(l => l.name)
  const { data: allLenses } = await supabaseAdmin
    .from('memories')
    .select('id, data_lens')
    .eq('account_id', accountId)
    .eq('active', true)
    .not('data_lens', 'is', null)

  if (allLenses) {
    for (const row of allLenses) {
      if (!activeLensNames.includes(row.data_lens)) {
        await supabaseAdmin
          .from('memories')
          .update({ active: false, updated_at: now })
          .eq('id', row.id)
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function s(n: number): string {
  return n === 1 ? '' : 's'
}

function daysSinceDateStr(dateStr: string, now: Date): number {
  const d = new Date(dateStr)
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000)
}

function bucketByAge(
  members: LensMember[],
  now: Date,
): { recent: number; mid: number; old: number } {
  let recent = 0
  let mid = 0
  let old = 0

  for (const m of members) {
    const days = daysSinceDateStr(m.memberSince, now)
    if (days >= 90) old++
    else if (days >= 30) mid++
    else recent++
  }

  return { recent, mid, old }
}

function parseIntervalMs(interval: string): number {
  const match = interval.match(/^(\d+)\s*(hours?|days?|minutes?)$/)
  if (!match) return 24 * 60 * 60 * 1000 // default 24h

  const value = parseInt(match[1], 10)
  const unit = match[2]

  if (unit.startsWith('minute')) return value * 60 * 1000
  if (unit.startsWith('hour')) return value * 60 * 60 * 1000
  if (unit.startsWith('day')) return value * 24 * 60 * 60 * 1000
  return 24 * 60 * 60 * 1000
}
