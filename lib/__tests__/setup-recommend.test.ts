/**
 * setup-recommend.test.ts
 *
 * TDD tests for the smart setup recommendation engine.
 * Validates the priority waterfall and data-driven recommendations.
 */

import { describe, it, expect } from 'vitest'
import { recommend, analyzeSnapshot, type SetupRecommendation } from '../setup-recommend'
import type { AccountSnapshot, MemberData, PaymentEvent } from '../agents/GMAgent'

// ── Factories ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-02-26T12:00:00Z')

function makeMember(overrides: Partial<MemberData> = {}): MemberData {
  return {
    id: 'member-1',
    name: 'Test Member',
    email: 'test@example.com',
    status: 'active',
    membershipType: 'Unlimited',
    memberSince: '2025-06-01',
    recentCheckinsCount: 8,
    previousCheckinsCount: 10,
    monthlyRevenue: 150,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    accountId: 'acct-001',
    accountName: 'Test Gym',
    members: [],
    recentCheckins: [],
    recentLeads: [],
    paymentEvents: [],
    capturedAt: NOW.toISOString(),
    ...overrides,
  }
}

function makePaymentEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    id: 'pe-1',
    memberId: 'member-1',
    memberName: 'Test Member',
    memberEmail: 'test@example.com',
    eventType: 'payment_failed',
    amount: 150,
    failedAt: '2026-02-20T00:00:00Z',
    ...overrides,
  }
}

// ── analyzeSnapshot ──────────────────────────────────────────────────────────

describe('analyzeSnapshot', () => {
  it('classifies active members', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
        makeMember({ id: 'm2', status: 'active', recentCheckinsCount: 6, previousCheckinsCount: 7 }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.activeMembers).toHaveLength(2)
    expect(analysis.atRiskMembers).toHaveLength(0)
  })

  it('flags members with zero recent checkins as at-risk', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', recentCheckinsCount: 0, previousCheckinsCount: 8 }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.atRiskMembers).toHaveLength(1)
    expect(analysis.noShowMembers).toHaveLength(1)
  })

  it('flags members with >50% attendance drop as at-risk', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', recentCheckinsCount: 2, previousCheckinsCount: 10 }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.atRiskMembers).toHaveLength(1)
    expect(analysis.noShowMembers).toHaveLength(0) // they still have some checkins
  })

  it('does not flag members with moderate dip', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', recentCheckinsCount: 6, previousCheckinsCount: 10 }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.atRiskMembers).toHaveLength(0)
  })

  it('classifies cancelled members', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', status: 'cancelled', recentCheckinsCount: 0, previousCheckinsCount: 5 }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.cancelledMembers).toHaveLength(1)
    expect(analysis.recentlyCancelled).toHaveLength(1) // had previous checkins
    expect(analysis.activeMembers).toHaveLength(0)
  })

  it('classifies prospects as leads', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', status: 'prospect' }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.leads).toHaveLength(1)
    expect(analysis.activeMembers).toHaveLength(0)
  })

  it('splits leads into fresh and stale (30-day threshold)', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'fresh1', status: 'prospect', memberSince: '2026-02-10' }),
        makeMember({ id: 'stale1', status: 'prospect', memberSince: '2025-12-01' }),
        makeMember({ id: 'stale2', status: 'prospect', memberSince: '2025-06-15' }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.leads).toHaveLength(3)
    expect(analysis.freshLeads).toHaveLength(1)
    expect(analysis.freshLeads[0].id).toBe('fresh1')
    expect(analysis.staleLeads).toHaveLength(2)
    expect(analysis.staleLeads.map(l => l.id)).toContain('stale1')
    expect(analysis.staleLeads.map(l => l.id)).toContain('stale2')
  })

  it('classifies new members (joined within 30 days)', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', memberSince: '2026-02-10' }),
        makeMember({ id: 'm2', memberSince: '2025-06-01' }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.newMembers).toHaveLength(1)
    expect(analysis.newMembers[0].id).toBe('m1')
  })

  it('identifies at-risk members correctly', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', recentCheckinsCount: 0, previousCheckinsCount: 8, monthlyRevenue: 175 }),
        makeMember({ id: 'm2', recentCheckinsCount: 1, previousCheckinsCount: 6, monthlyRevenue: 120 }),
      ],
    })
    const analysis = analyzeSnapshot(snapshot, NOW)
    expect(analysis.atRiskMembers).toHaveLength(2)
    expect(analysis.noShowMembers).toHaveLength(1)
    expect(analysis.noShowMembers[0].id).toBe('m1')
  })
})

// ── recommend (priority waterfall) ───────────────────────────────────────────

describe('recommend', () => {
  it('recommends churn_risk when at-risk members exist (priority 1)', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', recentCheckinsCount: 0, previousCheckinsCount: 8, monthlyRevenue: 150 }),
        makeMember({ id: 'm2', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
      paymentEvents: [makePaymentEvent()], // payment issues also exist
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('at_risk_detector')
    expect(rec.name).toBe('At-Risk Monitor')
    expect(rec.trigger.mode).toBe('cron')
    expect(rec.trigger.schedule).toBe('daily')
    expect(rec.stats.length).toBeGreaterThanOrEqual(2)
  })

  it('includes actionable reasoning in churn recommendation', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', recentCheckinsCount: 0, previousCheckinsCount: 8, monthlyRevenue: 150 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.reasoning).toContain('gone dark')
    expect(rec.reasoning).toContain('cancelled')
    expect(rec.reasoning).toContain('check-in')
  })

  it('recommends payment_recovery when no churn but payment issues (priority 2)', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
      paymentEvents: [makePaymentEvent()],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('payment_recovery')
    expect(rec.trigger.mode).toBe('event')
    expect(rec.trigger.event).toBe('payment.failed')
  })

  it('recommends win_back when recently cancelled members exist (priority 3)', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', status: 'cancelled', recentCheckinsCount: 0, previousCheckinsCount: 5, monthlyRevenue: 130 }),
        makeMember({ id: 'm2', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('win_back')
    expect(rec.trigger.event).toBe('member.cancelled')
  })

  it('recommends onboarding when new members exist (priority 4)', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'm1', memberSince: '2026-02-15', recentCheckinsCount: 3, previousCheckinsCount: 0 }),
        makeMember({ id: 'm2', memberSince: '2025-06-01', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('new_member_onboarding')
    expect(rec.name).toBe('Onboarding Coach')
    expect(rec.trigger.schedule).toBe('weekly')
  })

  it('recommends lead_reactivation when majority of leads are stale (priority 5)', () => {
    const snapshot = makeSnapshot({
      members: [
        // 3 old leads (created 90+ days ago)
        makeMember({ id: 'lead1', status: 'prospect', memberSince: '2025-10-01' }),
        makeMember({ id: 'lead2', status: 'prospect', memberSince: '2025-09-15' }),
        makeMember({ id: 'lead3', status: 'prospect', memberSince: '2025-11-01' }),
        // 1 fresh lead
        makeMember({ id: 'lead4', status: 'prospect', memberSince: '2026-02-20' }),
        // 1 active member (no risk signals)
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('lead_reactivation')
    expect(rec.name).toBe('Lead Re-Activation')
    expect(rec.trigger.mode).toBe('cron')
    expect(rec.trigger.schedule).toBe('daily')
    expect(rec.headline).toContain('ghost lead')
    expect(rec.stats.find(s => s.label === 'Ghost Leads')?.value).toBe(3)
  })

  it('recommends lead_reactivation when 3+ stale leads even with fresh leads too', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'lead1', status: 'prospect', memberSince: '2025-08-01' }),
        makeMember({ id: 'lead2', status: 'prospect', memberSince: '2025-09-01' }),
        makeMember({ id: 'lead3', status: 'prospect', memberSince: '2025-10-01' }),
        makeMember({ id: 'lead4', status: 'prospect', memberSince: '2026-02-20' }),
        makeMember({ id: 'lead5', status: 'prospect', memberSince: '2026-02-22' }),
        makeMember({ id: 'lead6', status: 'prospect', memberSince: '2026-02-24' }),
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('lead_reactivation')
    expect(rec.reasoning).toContain('never converted')
  })

  it('recommends lead_followup when leads are mostly fresh (priority 6)', () => {
    const snapshot = makeSnapshot({
      members: [
        // 2 fresh leads, 1 stale — majority fresh, under threshold of 3
        makeMember({ id: 'lead1', status: 'prospect', memberSince: '2026-02-20' }),
        makeMember({ id: 'lead2', status: 'prospect', memberSince: '2026-02-22' }),
        makeMember({ id: 'lead3', status: 'prospect', memberSince: '2025-12-01' }),
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('lead_followup')
    expect(rec.trigger.event).toBe('lead.created')
  })

  it('recommends lead_reactivation for a single old lead', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'lead1', status: 'prospect', memberSince: '2025-06-01' }),
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('lead_reactivation')
    expect(rec.headline).toContain('1 ghost lead')
  })

  it('recommends lead_followup for a single fresh lead', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ id: 'lead1', status: 'prospect', memberSince: '2026-02-20' }),
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('lead_followup')
  })

  it('lead_reactivation includes age context in reasoning', () => {
    const snapshot = makeSnapshot({
      members: [
        // Leads from 6+ months ago
        makeMember({ id: 'lead1', status: 'prospect', memberSince: '2025-05-01' }),
        makeMember({ id: 'lead2', status: 'prospect', memberSince: '2025-04-15' }),
        makeMember({ id: 'lead3', status: 'prospect', memberSince: '2025-06-01' }),
        makeMember({ id: 'm1', status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 10 }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('lead_reactivation')
    // Should mention age of the leads
    expect(rec.reasoning).toMatch(/months? old/)
    expect(rec.reasoning).toContain('10-15%')
  })

  it('falls back to generic retention monitor when nothing stands out', () => {
    const snapshot = makeSnapshot({
      members: [
        makeMember({ recentCheckinsCount: 8, previousCheckinsCount: 10, memberSince: '2025-06-01' }),
      ],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('at_risk_detector')
    expect(rec.name).toBe('Retention Monitor')
    expect(rec.headline).toContain('active member')
    expect(rec.reasoning).toContain('Members quit quietly')
  })

  it('returns fallback for empty snapshot', () => {
    const snapshot = makeSnapshot({ members: [] })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('at_risk_detector')
    expect(rec.name).toBe('Retention Monitor')
    expect(rec.headline).toContain('0 active members')
  })

  // ── Recommendation shape ─────────────────────────────────────────────────

  it('always includes required fields', () => {
    const snapshot = makeSnapshot({
      members: [makeMember({ recentCheckinsCount: 0, previousCheckinsCount: 8 })],
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBeTruthy()
    expect(rec.name).toBeTruthy()
    expect(rec.description).toBeTruthy()
    expect(rec.headline).toBeTruthy()
    expect(rec.reasoning).toBeTruthy()
    expect(rec.stats.length).toBeGreaterThan(0)
    expect(rec.trigger.mode).toMatch(/^(cron|event)$/)
  })

  it('stats have label and value', () => {
    const snapshot = makeSnapshot({
      members: [makeMember({ recentCheckinsCount: 0, previousCheckinsCount: 8 })],
    })
    const rec = recommend(snapshot, NOW)
    for (const stat of rec.stats) {
      expect(stat.label).toBeTruthy()
      expect(stat.value !== undefined && stat.value !== null).toBe(true)
    }
  })

  // ── Currency formatting ──────────────────────────────────────────────────

  it('handles many at-risk members with plural reasoning', () => {
    const snapshot = makeSnapshot({
      members: Array.from({ length: 20 }, (_, i) =>
        makeMember({
          id: `m${i}`,
          recentCheckinsCount: 0,
          previousCheckinsCount: 8,
          monthlyRevenue: 150,
        })
      ),
    })
    const rec = recommend(snapshot, NOW)
    expect(rec.reasoning).toContain('20 members have gone dark')
    expect(rec.reasoning).toContain('check-in')
    expect(rec.stats.find(s => s.label === 'At Risk')?.value).toBe(20)
  })

  // ── Mixed scenarios ──────────────────────────────────────────────────────

  it('handles a realistic gym with mixed member states', () => {
    const snapshot = makeSnapshot({
      members: [
        // Healthy active
        makeMember({ id: 'm1', recentCheckinsCount: 12, previousCheckinsCount: 10, memberSince: '2025-03-01' }),
        makeMember({ id: 'm2', recentCheckinsCount: 8, previousCheckinsCount: 8, memberSince: '2025-05-01' }),
        // At risk
        makeMember({ id: 'm3', recentCheckinsCount: 1, previousCheckinsCount: 10, monthlyRevenue: 175, memberSince: '2025-01-01' }),
        // No-show
        makeMember({ id: 'm4', recentCheckinsCount: 0, previousCheckinsCount: 6, monthlyRevenue: 150, memberSince: '2025-04-01' }),
        // New member
        makeMember({ id: 'm5', recentCheckinsCount: 4, previousCheckinsCount: 0, memberSince: '2026-02-10' }),
        // Cancelled
        makeMember({ id: 'm6', status: 'cancelled', recentCheckinsCount: 0, previousCheckinsCount: 3, memberSince: '2025-01-01' }),
        // Lead
        makeMember({ id: 'm7', status: 'prospect', recentCheckinsCount: 0, previousCheckinsCount: 0 }),
      ],
      paymentEvents: [makePaymentEvent()],
    })
    // Should pick churn_risk (highest priority, 2 at-risk members)
    const rec = recommend(snapshot, NOW)
    expect(rec.agentType).toBe('at_risk_detector')
    expect(rec.stats.find(s => s.label === 'At Risk')?.value).toBe(2)
  })
})
