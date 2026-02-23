/**
 * GMAgent.test.ts
 *
 * TDD tests for GMAgent — analyst + advisor mode.
 * All Claude calls are mocked via deps.claude.evaluate.
 * All DB calls are mocked via deps.db.
 * NEVER hits real APIs.
 *
 * Scenarios:
 *   - scoreChurnRisk: high frequency active → low risk
 *   - scoreChurnRisk: 14 days no visit → high risk
 *   - scoreChurnRisk: no visit + renewal in 7 days → critical
 *   - analyzeGym: 3 at-risk members → 3 churn_risk insights sorted by priority
 *   - analyzeGym: members who visited in last 3 days → ignored
 *   - analyzeGym: payment_failed events → payment_failed insights
 *   - runAnalysis: calls analyzeGym, creates agent_tasks, returns correct count
 *   - handleEvent: customer.status.changed cancelled → win_back task
 *   - handleEvent: checkin.created → no task created
 *   - draftMessage: calls deps.claude.evaluate, returns non-empty string
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GMAgent } from '../agents/GMAgent'
import type { AgentDeps } from '../agents/BaseAgent'
import type {
  GymSnapshot,
  MemberData,
  GymInsight,
  PushPressEvent,
  GymContext,
  CheckinData,
  LeadData,
  PaymentEvent,
} from '../agents/GMAgent'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date()

function daysAgo(n: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function daysFromNow(n: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

function makeMember(overrides: Partial<MemberData> = {}): MemberData {
  return {
    id: 'member-001',
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '555-1234',
    status: 'active',
    membershipType: 'unlimited',
    memberSince: daysAgo(365),
    lastCheckinAt: daysAgo(1),
    recentCheckinsCount: 12,
    previousCheckinsCount: 14,
    renewalDate: daysFromNow(20),
    monthlyRevenue: 89,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<GymSnapshot> = {}): GymSnapshot {
  return {
    gymId: 'gym-001',
    members: [],
    recentCheckins: [],
    recentLeads: [],
    paymentEvents: [],
    capturedAt: now.toISOString(),
    ...overrides,
  }
}

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  const db: AgentDeps['db'] = {
    getTask: vi.fn().mockResolvedValue(null),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    appendConversation: vi.fn().mockResolvedValue(undefined),
    getConversationHistory: vi.fn().mockResolvedValue([]),
    createOutboundMessage: vi.fn().mockResolvedValue({ id: 'msg-001' }),
    updateOutboundMessageStatus: vi.fn().mockResolvedValue(undefined),
  }

  const events: AgentDeps['events'] = {
    publishEvent: vi.fn().mockResolvedValue('event-id-001'),
  }

  const mailer: AgentDeps['mailer'] = {
    sendEmail: vi.fn().mockResolvedValue({ id: 'email-sent-001' }),
  }

  const claude: AgentDeps['claude'] = {
    evaluate: vi.fn().mockResolvedValue('Hey Jane, we miss you at the gym! Come back soon.'),
  }

  return {
    db: { ...db, ...(overrides.db ?? {}) },
    events: { ...events, ...(overrides.events ?? {}) },
    mailer: { ...mailer, ...(overrides.mailer ?? {}) },
    claude: { ...claude, ...(overrides.claude ?? {}) },
    ...(overrides.sms ? { sms: overrides.sms } : {}),
  }
}

// Extended deps with insight task creation
function makeExtendedDeps(
  baseOverrides: Partial<AgentDeps> = {},
  createInsightTask?: (params: any) => Promise<any>,
) {
  const base = makeDeps(baseOverrides)
  return {
    ...base,
    createInsightTask: createInsightTask ?? vi.fn().mockResolvedValue({ id: 'task-new-001' }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreChurnRisk tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GMAgent.scoreChurnRisk', () => {
  it('returns low risk for active member with high recent frequency', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const member = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(1),
      recentCheckinsCount: 16,    // 4x/week
      previousCheckinsCount: 15,
      renewalDate: daysFromNow(25),
    })

    const result = agent.scoreChurnRisk(member)

    expect(result.score).toBeLessThan(0.3)
    expect(result.level).toBe('low')
  })

  it('returns high risk for member not visited in 14 days', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const member = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 2,
      previousCheckinsCount: 10,
      renewalDate: daysFromNow(20),
    })

    const result = agent.scoreChurnRisk(member)

    expect(result.score).toBeGreaterThanOrEqual(0.6)
    expect(['high', 'critical']).toContain(result.level)
    expect(result.factors.some(f => f.toLowerCase().includes('day'))).toBe(true)
  })

  it('returns critical risk for member not visited + renewal in 7 days', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const member = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
      renewalDate: daysFromNow(7),
    })

    const result = agent.scoreChurnRisk(member)

    expect(result.score).toBeGreaterThanOrEqual(0.8)
    expect(result.level).toBe('critical')
    expect(result.factors.some(f => f.toLowerCase().includes('renewal') || f.toLowerCase().includes('day'))).toBe(true)
  })

  it('returns factors array with human-readable strings', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const member = makeMember({
      lastCheckinAt: daysAgo(10),
      recentCheckinsCount: 2,
      previousCheckinsCount: 12,
    })

    const result = agent.scoreChurnRisk(member)
    expect(Array.isArray(result.factors)).toBe(true)
    expect(result.factors.length).toBeGreaterThan(0)
  })

  it('returns medium risk for member with moderate drop in attendance', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const member = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(6),
      recentCheckinsCount: 4,
      previousCheckinsCount: 12,
      renewalDate: daysFromNow(20),
    })

    const result = agent.scoreChurnRisk(member)

    expect(result.score).toBeGreaterThan(0.2)
    expect(result.score).toBeLessThan(0.9)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// analyzeGym tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GMAgent.analyzeGym', () => {
  it('returns 3 churn_risk insights for snapshot with 3 at-risk members, sorted by priority', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    // Critical: no visit 14 days + renewal in 7 days
    const criticalMember = makeMember({
      id: 'member-critical',
      name: 'Alice Critical',
      email: 'alice@example.com',
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 12,
      renewalDate: daysFromNow(7),
      monthlyRevenue: 99,
    })

    // High: no visit 14 days
    const highMember = makeMember({
      id: 'member-high',
      name: 'Bob High',
      email: 'bob@example.com',
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 2,
      previousCheckinsCount: 10,
      renewalDate: daysFromNow(25),
      monthlyRevenue: 79,
    })

    // Medium: no visit 7 days, moderate drop
    const mediumMember = makeMember({
      id: 'member-medium',
      name: 'Carol Medium',
      email: 'carol@example.com',
      status: 'active',
      lastCheckinAt: daysAgo(7),
      recentCheckinsCount: 4,
      previousCheckinsCount: 12,
      renewalDate: daysFromNow(25),
      monthlyRevenue: 69,
    })

    const snapshot = makeSnapshot({ members: [criticalMember, highMember, mediumMember] })
    const insights = agent.analyzeGym(snapshot)

    const churnInsights = insights.filter(i => i.type === 'churn_risk')
    expect(churnInsights).toHaveLength(3)

    // Should be sorted critical → high → medium
    const priorities = churnInsights.map(i => i.priority)
    expect(priorities[0]).toBe('critical')
    expect(priorities[1]).toBe('high')
  })

  it('ignores members who visited in last 3 days', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const recentMember = makeMember({
      id: 'member-recent',
      status: 'active',
      lastCheckinAt: daysAgo(2),   // visited 2 days ago
      recentCheckinsCount: 14,
      previousCheckinsCount: 12,
    })

    const snapshot = makeSnapshot({ members: [recentMember] })
    const insights = agent.analyzeGym(snapshot)

    const churnInsights = insights.filter(i => i.type === 'churn_risk')
    expect(churnInsights).toHaveLength(0)
  })

  it('creates payment_failed insights from payment events', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const paymentEvent: PaymentEvent = {
      id: 'pay-001',
      memberId: 'member-001',
      memberName: 'Jane Smith',
      memberEmail: 'jane@example.com',
      eventType: 'payment_failed',
      amount: 89,
      failedAt: daysAgo(1),
    }

    const snapshot = makeSnapshot({ paymentEvents: [paymentEvent] })
    const insights = agent.analyzeGym(snapshot)

    const payInsights = insights.filter(i => i.type === 'payment_failed')
    expect(payInsights).toHaveLength(1)
    expect(payInsights[0].memberEmail).toBe('jane@example.com')
    expect(payInsights[0].priority).toBe('critical')
  })

  it('includes estimated impact in churn_risk insights', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const atRiskMember = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
      monthlyRevenue: 89,
    })

    const snapshot = makeSnapshot({ members: [atRiskMember] })
    const insights = agent.analyzeGym(snapshot)

    const churnInsight = insights.find(i => i.type === 'churn_risk')
    expect(churnInsight).toBeDefined()
    expect(churnInsight!.estimatedImpact).toContain('89')
  })

  it('includes member info in churn_risk insights', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const member = makeMember({
      id: 'member-x',
      name: 'Test Member',
      email: 'test@example.com',
      status: 'active',
      lastCheckinAt: daysAgo(12),
      recentCheckinsCount: 2,
      previousCheckinsCount: 10,
    })

    const snapshot = makeSnapshot({ members: [member] })
    const insights = agent.analyzeGym(snapshot)

    const insight = insights.find(i => i.type === 'churn_risk')
    expect(insight).toBeDefined()
    expect(insight!.memberId).toBe('member-x')
    expect(insight!.memberName).toBe('Test Member')
    expect(insight!.memberEmail).toBe('test@example.com')
  })

  it('does not generate churn_risk for cancelled members', () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const cancelledMember = makeMember({
      status: 'cancelled',
      lastCheckinAt: daysAgo(20),
      recentCheckinsCount: 0,
      previousCheckinsCount: 10,
    })

    const snapshot = makeSnapshot({ members: [cancelledMember] })
    const insights = agent.analyzeGym(snapshot)

    // Cancelled members should not generate churn_risk (they already churned)
    const churnInsights = insights.filter(i => i.type === 'churn_risk')
    expect(churnInsights).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runAnalysis tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GMAgent.runAnalysis', () => {
  it('calls analyzeGym and returns correct insight count', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-new-001' })
    agent.setCreateInsightTask(createInsightTask)

    const atRiskMember = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
    })

    const snapshot = makeSnapshot({ members: [atRiskMember] })
    const result = await agent.runAnalysis('gym-001', snapshot)

    expect(result.gymId).toBe('gym-001')
    expect(result.insightsFound).toBeGreaterThan(0)
    expect(result.insights.length).toBe(result.insightsFound)
  })

  it('creates agent_tasks for each insight found', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-new-001' })
    agent.setCreateInsightTask(createInsightTask)

    const member1 = makeMember({
      id: 'member-a',
      email: 'a@example.com',
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
    })

    const member2 = makeMember({
      id: 'member-b',
      email: 'b@example.com',
      status: 'active',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
    })

    const snapshot = makeSnapshot({ members: [member1, member2] })
    const result = await agent.runAnalysis('gym-001', snapshot)

    // Should create one task per insight
    expect(createInsightTask).toHaveBeenCalledTimes(result.tasksCreated)
    expect(result.tasksCreated).toBe(result.insightsFound)
  })

  it('returns tasksCreated = insightsFound when all succeed', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-new-001' })
    agent.setCreateInsightTask(createInsightTask)

    const member = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(10),
      recentCheckinsCount: 2,
      previousCheckinsCount: 12,
    })

    const snapshot = makeSnapshot({ members: [member] })
    const result = await agent.runAnalysis('gym-001', snapshot)

    expect(result.tasksCreated).toBe(result.insightsFound)
  })

  it('returns insightsFound=0 when no at-risk members', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-new-001' })
    agent.setCreateInsightTask(createInsightTask)

    const healthyMember = makeMember({
      status: 'active',
      lastCheckinAt: daysAgo(1),
      recentCheckinsCount: 14,
      previousCheckinsCount: 12,
      renewalDate: daysFromNow(25),
    })

    const snapshot = makeSnapshot({ members: [healthyMember] })
    const result = await agent.runAnalysis('gym-001', snapshot)

    expect(result.insightsFound).toBe(0)
    expect(result.tasksCreated).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// handleEvent tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GMAgent.handleEvent', () => {
  it('customer.status.changed (cancelled) → creates win_back task immediately', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-win-back-001' })
    agent.setCreateInsightTask(createInsightTask)

    const event: PushPressEvent = {
      type: 'customer.status.changed',
      data: {
        customerId: 'member-001',
        customerName: 'Jane Smith',
        customerEmail: 'jane@example.com',
        newStatus: 'cancelled',
        previousStatus: 'active',
        monthlyRevenue: 89,
      },
    }

    await agent.handleEvent('gym-001', event)

    expect(createInsightTask).toHaveBeenCalledTimes(1)
    const call = createInsightTask.mock.calls[0][0]
    expect(call.insight.type).toBe('win_back')
    expect(call.gymId).toBe('gym-001')
  })

  it('customer.status.changed (paused) → creates relevant task', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-paused-001' })
    agent.setCreateInsightTask(createInsightTask)

    const event: PushPressEvent = {
      type: 'customer.status.changed',
      data: {
        customerId: 'member-002',
        customerName: 'Bob Paused',
        customerEmail: 'bob@example.com',
        newStatus: 'paused',
        previousStatus: 'active',
        monthlyRevenue: 79,
      },
    }

    await agent.handleEvent('gym-001', event)

    expect(createInsightTask).toHaveBeenCalled()
  })

  it('checkin.created → does not create a task (just a positive signal)', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-001' })
    agent.setCreateInsightTask(createInsightTask)

    const event: PushPressEvent = {
      type: 'checkin.created',
      data: {
        customerId: 'member-001',
        customerName: 'Jane Smith',
        customerEmail: 'jane@example.com',
        checkinAt: now.toISOString(),
      },
    }

    await agent.handleEvent('gym-001', event)

    // No task should be created for a regular check-in
    expect(createInsightTask).not.toHaveBeenCalled()
  })

  it('does not throw on unknown event types', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    agent.setCreateInsightTask(vi.fn())

    const event: PushPressEvent = {
      type: 'enrollment.created',
      data: { customerId: 'member-001' },
    }

    await expect(agent.handleEvent('gym-001', event)).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// draftMessage tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GMAgent.draftMessage', () => {
  it('calls deps.claude.evaluate with member context', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const insight: GymInsight = {
      type: 'churn_risk',
      priority: 'high',
      memberId: 'member-001',
      memberName: 'Jane Smith',
      memberEmail: 'jane@example.com',
      title: "Jane hasn't been in 12 days",
      detail: 'Risk score 74%. Used to visit 4x/week.',
      recommendedAction: 'Send a personal check-in',
      estimatedImpact: '$89/mo at risk',
    }

    const gymContext: GymContext = {
      gymId: 'gym-001',
      gymName: 'Iron & Grit CrossFit',
      ownerName: 'Coach Mike',
    }

    const result = await agent.draftMessage(insight, gymContext)

    expect(deps.claude.evaluate).toHaveBeenCalledTimes(1)
    const [system, prompt] = (deps.claude.evaluate as any).mock.calls[0]
    expect(system).toBeTruthy()
    expect(prompt).toContain('Jane')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns non-empty string from Claude', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue('Hey Jane! We miss seeing you at Iron & Grit. Everything okay?'),
      },
    })
    const agent = new GMAgent(deps)

    const insight: GymInsight = {
      type: 'churn_risk',
      priority: 'high',
      memberName: 'Jane Smith',
      memberEmail: 'jane@example.com',
      title: "Jane hasn't been in 12 days",
      detail: 'Risk score 74%.',
      recommendedAction: 'Send a personal check-in',
      estimatedImpact: '$89/mo at risk',
    }

    const gymContext: GymContext = {
      gymId: 'gym-001',
      gymName: 'Iron & Grit CrossFit',
      ownerName: 'Coach Mike',
    }

    const result = await agent.draftMessage(insight, gymContext)

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(10)
    expect(result).toContain('Jane')
  })

  it('includes gym context in the prompt for voice consistency', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)

    const insight: GymInsight = {
      type: 'payment_failed',
      priority: 'critical',
      memberName: 'Bob Jones',
      memberEmail: 'bob@example.com',
      title: "Bob's payment failed",
      detail: 'Payment of $89 failed 1 day ago.',
      recommendedAction: 'Reach out about payment',
      estimatedImpact: '$89 at risk',
    }

    const gymContext: GymContext = {
      gymId: 'gym-001',
      gymName: 'CrossFit Downtown',
      ownerName: 'Sarah',
    }

    await agent.draftMessage(insight, gymContext)

    const [, prompt] = (deps.claude.evaluate as any).mock.calls[0]
    expect(prompt).toContain('CrossFit Downtown')
  })
})
