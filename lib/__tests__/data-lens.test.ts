/**
 * data-lens.test.ts
 *
 * Tests for the data lens system — connector-backed, refreshable memory summaries.
 * Validates segmentation logic, lens content generation, staleness checks,
 * and DB upsert behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccountSnapshot } from '../agents/GMAgent'

// ── Mock supabase ──────────────────────────────────────────────────────────────

const mockFrom = vi.fn()
vi.mock('../supabase', () => ({
  supabaseAdmin: { from: (...args: any[]) => mockFrom(...args) },
}))

import { harvestDataLenses, getStaleLenses } from '../data-lens'
import type { DataLens } from '../data-lens'

// ── Test fixtures ──────────────────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<AccountSnapshot>): AccountSnapshot {
  return {
    accountId: 'acct-001',
    accountName: 'Test Gym',
    members: [],
    recentCheckins: [],
    recentLeads: [],
    paymentEvents: [],
    capturedAt: '2026-02-26T08:00:00Z',
    ...overrides,
  }
}

function makeActiveMember(id: string, name: string, opts: {
  daysSinceVisit?: number
  monthlyRevenue?: number
  memberSince?: string
} = {}) {
  const now = new Date('2026-02-26T08:00:00Z')
  const lastCheckin = opts.daysSinceVisit != null
    ? new Date(now.getTime() - opts.daysSinceVisit * 86_400_000).toISOString()
    : null
  return {
    id,
    name,
    email: `${id}@example.com`,
    status: 'active' as const,
    membershipType: 'Unlimited',
    memberSince: opts.memberSince ?? '2025-06-01',
    lastCheckinAt: lastCheckin,
    recentCheckinsCount: 5,
    previousCheckinsCount: 10,
    monthlyRevenue: opts.monthlyRevenue ?? 150,
  }
}

function makeCancelledMember(id: string, name: string, opts: {
  monthlyRevenue?: number
  memberSince?: string
} = {}) {
  return {
    id,
    name,
    email: `${id}@example.com`,
    status: 'cancelled' as const,
    membershipType: 'Monthly',
    memberSince: opts.memberSince ?? '2025-06-01',
    lastCheckinAt: '2026-01-15T00:00:00Z',
    recentCheckinsCount: 0,
    previousCheckinsCount: 8,
    monthlyRevenue: opts.monthlyRevenue ?? 99,
  }
}

function makeProspectMember(id: string, name: string, opts: {
  memberSince?: string
} = {}) {
  return {
    id,
    name,
    email: `${id}@example.com`,
    status: 'prospect' as const,
    membershipType: null as any,
    memberSince: opts.memberSince ?? '2025-12-01',
    lastCheckinAt: null,
    recentCheckinsCount: 0,
    previousCheckinsCount: 0,
    monthlyRevenue: 0,
  }
}

// ── Chain helper (mirrors memories.test.ts pattern) ────────────────────────────

function buildChain(result: { data: any; error: any }) {
  const chain: any = {}
  const methods = ['select', 'insert', 'update', 'eq', 'or', 'gte', 'not', 'order', 'single', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single.mockResolvedValue(result)
  chain.maybeSingle.mockResolvedValue(result)
  // For non-single queries, make terminal calls resolve
  chain.eq.mockReturnValue({ ...chain, then: (fn: any) => Promise.resolve(result).then(fn) })
  chain.not.mockReturnValue({ ...chain, then: (fn: any) => Promise.resolve(result).then(fn) })
  return chain
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-02-26T08:00:00Z'))
})

describe('harvestDataLenses', () => {
  it('always creates a business_overview lens', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const lenses = await harvestDataLenses('acct-001', makeSnapshot())

    expect(lenses.some(l => l.name === 'business_overview')).toBe(true)
    const overview = lenses.find(l => l.name === 'business_overview')!
    expect(overview.scope).toBe('global')
    expect(overview.staleAfter).toBe('24 hours')
    expect(overview.content).toContain('0 active member')
  })

  it('creates ghost_leads lens for prospects', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        makeProspectMember('p1', 'Ghost Lead', { memberSince: '2025-10-01' }),
        makeProspectMember('p2', 'Recent Lead', { memberSince: '2026-02-15' }),
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const ghostLeads = lenses.find(l => l.name === 'ghost_leads')!
    expect(ghostLeads).toBeDefined()
    expect(ghostLeads.scope).toBe('sales')
    expect(ghostLeads.content).toContain('2 prospects')
    expect(ghostLeads.content).toContain('never converted')
    expect(ghostLeads.snapshot.count).toBe(2)
    expect(ghostLeads.snapshot.ids).toEqual(['p1', 'p2'])
  })

  it('merges recentLeads into prospects without duplicates', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        makeProspectMember('p1', 'Existing Prospect'),
      ],
      recentLeads: [
        { id: 'p1', name: 'Existing Prospect', email: 'p1@example.com', createdAt: '2026-02-20', status: 'new' as const },
        { id: 'l1', name: 'New Lead', email: 'l1@example.com', createdAt: '2026-02-22', status: 'new' as const },
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const ghostLeads = lenses.find(l => l.name === 'ghost_leads')!
    expect(ghostLeads.snapshot.count).toBe(2) // p1 + l1, not 3
    expect(ghostLeads.snapshot.ids).toContain('p1')
    expect(ghostLeads.snapshot.ids).toContain('l1')
  })

  it('creates ex_members lens for cancelled members', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        makeCancelledMember('x1', 'Former Member', { monthlyRevenue: 120, memberSince: '2026-02-01' }),
        makeCancelledMember('x2', 'Old Member', { monthlyRevenue: 99, memberSince: '2025-06-01' }),
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const exMembers = lenses.find(l => l.name === 'ex_members')!
    expect(exMembers).toBeDefined()
    expect(exMembers.scope).toBe('retention')
    expect(exMembers.content).toContain('2 ex-members')
    expect(exMembers.content).toContain('cancelled')
    expect(exMembers.content).toContain('$219/mo')
    expect(exMembers.snapshot.count).toBe(2)
    expect(exMembers.snapshot.lost_revenue_monthly).toBe(219)
  })

  it('creates active_at_risk lens for members 14+ days absent', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        makeActiveMember('m1', 'Active Regular', { daysSinceVisit: 3 }),
        makeActiveMember('m2', 'Medium Risk', { daysSinceVisit: 16, monthlyRevenue: 100 }),
        makeActiveMember('m3', 'High Risk', { daysSinceVisit: 25, monthlyRevenue: 200 }),
        makeActiveMember('m4', 'Critical Risk', { daysSinceVisit: 35, monthlyRevenue: 150 }),
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const atRisk = lenses.find(l => l.name === 'active_at_risk')!
    expect(atRisk).toBeDefined()
    expect(atRisk.scope).toBe('retention')
    expect(atRisk.staleAfter).toBe('6 hours')
    expect(atRisk.content).toContain('3 active members')
    expect(atRisk.content).toContain('disengagement')
    expect(atRisk.snapshot.count).toBe(3)
    expect(atRisk.snapshot.segments).toEqual({ critical: 1, high: 1, medium: 1 })
    expect(atRisk.snapshot.revenue_at_risk).toBe(450) // 100 + 200 + 150
  })

  it('does not create active_at_risk when all members are active', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        makeActiveMember('m1', 'Active Regular', { daysSinceVisit: 3 }),
        makeActiveMember('m2', 'Active Frequent', { daysSinceVisit: 1 }),
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    expect(lenses.find(l => l.name === 'active_at_risk')).toBeUndefined()
  })

  it('creates payment_issues lens for failed payments', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      paymentEvents: [
        {
          id: 'p1', memberId: 'm1', memberName: 'Sarah', memberEmail: 'sarah@test.com',
          eventType: 'payment_failed' as const, amount: 150, failedAt: '2026-02-25',
        },
        {
          id: 'p2', memberId: 'm2', memberName: 'Mike', memberEmail: 'mike@test.com',
          eventType: 'payment_failed' as const, amount: 99, failedAt: '2026-02-25',
        },
        {
          id: 'p3', memberId: 'm3', memberName: 'Emma', memberEmail: 'emma@test.com',
          eventType: 'payment_succeeded' as const, amount: 200, failedAt: '2026-02-20',
        },
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const payments = lenses.find(l => l.name === 'payment_issues')!
    expect(payments).toBeDefined()
    expect(payments.content).toContain('2 members')
    expect(payments.content).toContain('failed payments')
    expect(payments.snapshot.count).toBe(2)
    expect(payments.snapshot.total_amount).toBe(249)
  })

  it('does not create payment_issues when no failures', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      paymentEvents: [
        {
          id: 'p1', memberId: 'm1', memberName: 'Sarah', memberEmail: 'sarah@test.com',
          eventType: 'payment_succeeded' as const, amount: 150, failedAt: '2026-02-25',
        },
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    expect(lenses.find(l => l.name === 'payment_issues')).toBeUndefined()
  })

  it('business_overview includes all segments', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        makeActiveMember('m1', 'Active', { monthlyRevenue: 150 }),
        makeCancelledMember('x1', 'Ex'),
        makeProspectMember('p1', 'Prospect'),
        { ...makeActiveMember('m2', 'Paused'), status: 'paused' as any },
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const overview = lenses.find(l => l.name === 'business_overview')!
    expect(overview.content).toContain('1 active member')
    expect(overview.content).toContain('1 paused')
    expect(overview.content).toContain('1 ex-member')
    expect(overview.content).toContain('1 unconverted prospect')
    expect(overview.content).toContain('$150')
    expect(overview.snapshot.segments).toEqual({
      active: 1,
      paused: 1,
      ex_members: 1,
      prospects: 1,
    })
  })

  it('upserts lenses to the memories table', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await harvestDataLenses('acct-001', makeSnapshot({
      members: [makeActiveMember('m1', 'Active')],
    }))

    // Should call supabaseAdmin.from('memories') for upsert operations
    expect(mockFrom).toHaveBeenCalledWith('memories')
  })

  it('buckets prospects by age correctly', async () => {
    const chain = buildChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const snapshot = makeSnapshot({
      members: [
        // 148 days old → old bucket (90+)
        makeProspectMember('p1', 'Old Lead', { memberSince: '2025-10-01' }),
        // 57 days old → mid bucket (30-90)
        makeProspectMember('p2', 'Mid Lead', { memberSince: '2025-12-31' }),
        // 11 days old → recent bucket (<30)
        makeProspectMember('p3', 'New Lead', { memberSince: '2026-02-15' }),
      ],
    })

    const lenses = await harvestDataLenses('acct-001', snapshot)

    const ghostLeads = lenses.find(l => l.name === 'ghost_leads')!
    expect(ghostLeads.snapshot.segments).toEqual({ recent: 1, mid: 1, old: 1 })
    expect(ghostLeads.content).toContain('1 high-priority (90+ days old)')
    expect(ghostLeads.content).toContain('1 medium-priority (30-90 days)')
    expect(ghostLeads.content).toContain('1 recent (under 30 days')
  })
})

describe('getStaleLenses', () => {
  it('returns empty array when no lenses exist', async () => {
    const chain = buildChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    const stale = await getStaleLenses('acct-001')
    expect(stale).toEqual([])
  })

  it('returns empty array on DB error', async () => {
    const chain = buildChain({ data: null, error: { message: 'DB down' } })
    mockFrom.mockReturnValue(chain)

    const stale = await getStaleLenses('acct-001')
    expect(stale).toEqual([])
  })

  it('marks lenses without refreshed_at as stale', async () => {
    const chain = buildChain({
      data: [
        { data_lens: 'ghost_leads', refreshed_at: null, stale_after: '12 hours' },
      ],
      error: null,
    })
    mockFrom.mockReturnValue(chain)

    const stale = await getStaleLenses('acct-001')
    expect(stale).toEqual(['ghost_leads'])
  })

  it('marks lenses past their stale_after interval as stale', async () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
    const chain = buildChain({
      data: [
        { data_lens: 'ghost_leads', refreshed_at: thirteenHoursAgo, stale_after: '12 hours' },
        { data_lens: 'business_overview', refreshed_at: new Date().toISOString(), stale_after: '24 hours' },
      ],
      error: null,
    })
    mockFrom.mockReturnValue(chain)

    const stale = await getStaleLenses('acct-001')
    expect(stale).toEqual(['ghost_leads'])
    expect(stale).not.toContain('business_overview')
  })

  it('treats recently refreshed lenses as fresh', async () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    const chain = buildChain({
      data: [
        { data_lens: 'active_at_risk', refreshed_at: oneHourAgo, stale_after: '6 hours' },
      ],
      error: null,
    })
    mockFrom.mockReturnValue(chain)

    const stale = await getStaleLenses('acct-001')
    expect(stale).toEqual([])
  })

  it('queries memories table with correct filters', async () => {
    const chain = buildChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    await getStaleLenses('acct-001')

    expect(mockFrom).toHaveBeenCalledWith('memories')
    expect(chain.select).toHaveBeenCalledWith('data_lens, refreshed_at, stale_after')
    expect(chain.eq).toHaveBeenCalledWith('account_id', 'acct-001')
    expect(chain.eq).toHaveBeenCalledWith('active', true)
    expect(chain.not).toHaveBeenCalledWith('data_lens', 'is', null)
  })
})
