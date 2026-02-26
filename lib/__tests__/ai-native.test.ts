/**
 * ai-native.test.ts
 *
 * Tests for Phase 0.5: AI-native architecture shift.
 *
 * Covers:
 *   - Skill file YAML front-matter parsing
 *   - Semantic skill selection (selectRelevantSkills)
 *   - Skill index loading (loadSkillIndex)
 *   - Multi-skill prompt building
 *   - AI-driven analysis (analyzeGymAI) with mocked Claude
 *   - Formula validation / fallback behavior
 *   - Flexible InsightType (AI-assigned types)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseSkillFrontMatter,
  loadSkillIndex,
  selectRelevantSkills,
  loadAllSkillSummaries,
  buildMultiSkillPrompt,
  _clearCaches,
} from '../skill-loader'
import { GMAgent } from '../agents/GMAgent'
import type { AgentDeps } from '../agents/BaseAgent'
import type { GymSnapshot, MemberData, GymInsight } from '../agents/GMAgent'

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
    gymName: 'Test Gym',
    members: [],
    recentCheckins: [],
    recentLeads: [],
    paymentEvents: [],
    capturedAt: now.toISOString(),
    ...overrides,
  }
}

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    db: {
      getTask: vi.fn().mockResolvedValue(null),
      updateTaskStatus: vi.fn().mockResolvedValue(undefined),
      appendConversation: vi.fn().mockResolvedValue(undefined),
      getConversationHistory: vi.fn().mockResolvedValue([]),
      createOutboundMessage: vi.fn().mockResolvedValue({ id: 'msg-001' }),
      updateOutboundMessageStatus: vi.fn().mockResolvedValue(undefined),
    },
    events: {
      publishEvent: vi.fn().mockResolvedValue('event-id-001'),
    },
    mailer: {
      sendEmail: vi.fn().mockResolvedValue({ id: 'email-sent-001' }),
    },
    claude: {
      evaluate: vi.fn().mockResolvedValue('{}'),
    },
    ...overrides,
  }
}

// ── parseSkillFrontMatter ────────────────────────────────────────────────────

describe('parseSkillFrontMatter', () => {
  it('parses YAML front-matter with all fields', () => {
    const content = `---
id: churn-risk
applies_when: "member attendance has dropped"
domain: retention
triggers: ["attendance_drop", "no_recent_visits"]
---

# Churn Risk — Task Skill

Content here.`

    const { meta, body } = parseSkillFrontMatter(content)

    expect(meta.id).toBe('churn-risk')
    expect(meta.applies_when).toBe('member attendance has dropped')
    expect(meta.domain).toBe('retention')
    expect(meta.triggers).toEqual(['attendance_drop', 'no_recent_visits'])
    expect(body).toContain('# Churn Risk')
    expect(body).not.toContain('---')
  })

  it('returns full content as body when no front-matter', () => {
    const content = '# No Front Matter\n\nJust content.'
    const { meta, body } = parseSkillFrontMatter(content)

    expect(Object.keys(meta)).toHaveLength(0)
    expect(body).toBe(content)
  })

  it('handles single-value triggers', () => {
    const content = `---
triggers: ["single_trigger"]
---
body`

    const { meta } = parseSkillFrontMatter(content)
    expect(meta.triggers).toEqual(['single_trigger'])
  })

  it('strips quotes from string values', () => {
    const content = `---
id: "quoted-id"
domain: 'single-quoted'
---
body`

    const { meta } = parseSkillFrontMatter(content)
    expect(meta.id).toBe('quoted-id')
    expect(meta.domain).toBe('single-quoted')
  })
})

// ── loadSkillIndex ───────────────────────────────────────────────────────────

describe('loadSkillIndex', () => {
  beforeEach(() => {
    _clearCaches()
  })

  it('loads all skill files with metadata', async () => {
    const skills = await loadSkillIndex()

    expect(skills.length).toBeGreaterThan(0)

    // All skills should have an id and applies_when
    for (const skill of skills) {
      expect(skill.id).toBeTruthy()
      expect(skill.filename).toMatch(/\.md$/)
    }
  })

  it('includes churn-risk skill with correct metadata', async () => {
    const skills = await loadSkillIndex()
    const churnRisk = skills.find(s => s.id === 'churn-risk')

    expect(churnRisk).toBeDefined()
    expect(churnRisk!.applies_when).toContain('attendance')
    expect(churnRisk!.domain).toBe('retention')
    expect(churnRisk!.triggers).toContain('attendance_drop')
  })

  it('includes win-back skill with correct metadata', async () => {
    const skills = await loadSkillIndex()
    const winBack = skills.find(s => s.id === 'win-back')

    expect(winBack).toBeDefined()
    expect(winBack!.applies_when).toContain('cancelled')
    expect(winBack!.triggers).toContain('membership_cancelled')
  })

  it('excludes _base.md from index', async () => {
    const skills = await loadSkillIndex()
    const base = skills.find(s => s.filename === '_base.md')

    expect(base).toBeUndefined()
  })
})

// ── selectRelevantSkills ─────────────────────────────────────────────────────

describe('selectRelevantSkills', () => {
  beforeEach(() => {
    _clearCaches()
  })

  it('matches churn-risk skill for attendance drop description', async () => {
    const skills = await selectRelevantSkills(
      'member attendance has dropped significantly and they haven\'t visited recently'
    )

    expect(skills.length).toBeGreaterThan(0)
    expect(skills[0].id).toBe('churn-risk')
  })

  it('matches win-back skill for cancellation description', async () => {
    const skills = await selectRelevantSkills(
      'member has cancelled their membership and we want to win them back'
    )

    expect(skills.length).toBeGreaterThan(0)
    const ids = skills.map(s => s.id)
    expect(ids).toContain('win-back')
  })

  it('matches payment-recovery for payment failure description', async () => {
    const skills = await selectRelevantSkills(
      'payment_failed billing alert card expired'
    )

    expect(skills.length).toBeGreaterThan(0)
    const ids = skills.map(s => s.id)
    expect(ids).toContain('payment-recovery')
  })

  it('matches lead-followup for new lead description', async () => {
    const skills = await selectRelevantSkills(
      'a new_lead signed up for a trial but hasn\'t committed yet'
    )

    expect(skills.length).toBeGreaterThan(0)
    const ids = skills.map(s => s.id)
    expect(ids).toContain('lead-followup')
  })

  it('returns max 2 skills by default', async () => {
    const skills = await selectRelevantSkills(
      'retention member attendance cancelled payment'
    )

    expect(skills.length).toBeLessThanOrEqual(2)
  })

  it('falls back to legacy mapping when no semantic match', async () => {
    const skills = await selectRelevantSkills(
      'zzz completely unrelated description zzz',
      { taskType: 'churn_risk' }
    )

    expect(skills.length).toBe(1)
    expect(skills[0].filename).toBe('churn-risk.md')
  })

  it('returns empty array for garbage with no taskType fallback', async () => {
    const skills = await selectRelevantSkills(
      'zzz completely unrelated gibberish zzz'
    )

    expect(skills).toHaveLength(0)
  })
})

// ── loadAllSkillSummaries ────────────────────────────────────────────────────

describe('loadAllSkillSummaries', () => {
  beforeEach(() => {
    _clearCaches()
  })

  it('returns a formatted summary of all skills', async () => {
    const summaries = await loadAllSkillSummaries()

    expect(summaries).toContain('churn-risk')
    expect(summaries).toContain('win-back')
    expect(summaries).toContain('lead-followup')
    expect(summaries).toContain('**When:**')
    expect(summaries).toContain('**Domain:**')
  })
})

// ── buildMultiSkillPrompt ────────────────────────────────────────────────────

describe('buildMultiSkillPrompt', () => {
  beforeEach(() => {
    _clearCaches()
  })

  it('combines base with multiple skill bodies', async () => {
    const skills = await loadSkillIndex()
    const twoSkills = skills.slice(0, 2)

    const prompt = await buildMultiSkillPrompt(twoSkills)

    expect(prompt).toContain('Base Instructions')
    expect(prompt).toContain(twoSkills[0].body.slice(0, 50))
    expect(prompt).toContain(twoSkills[1].body.slice(0, 50))
  })

  it('returns base-only for empty skill array', async () => {
    const prompt = await buildMultiSkillPrompt([])

    expect(prompt).toContain('Base Instructions')
  })
})

// ── GMAgent.analyzeGymAI ─────────────────────────────────────────────────────

describe('GMAgent.analyzeGymAI', () => {
  it('calls Claude with member data and returns parsed insights', async () => {
    const aiResponse = JSON.stringify({
      insights: [
        {
          type: 'churn_risk',
          priority: 'high',
          memberId: 'member-001',
          memberName: 'Jane Smith',
          memberEmail: 'jane@example.com',
          title: 'Jane hasn\'t been in 14 days',
          detail: 'Attendance dropped from 12 to 2 visits. High churn risk.',
          recommendedAction: 'Send a personal check-in message',
          estimatedImpact: '$89/mo at risk',
        },
      ],
    })

    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockResolvedValue(aiResponse) },
    })
    const agent = new GMAgent(deps)

    const atRiskMember = makeMember({
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 2,
      previousCheckinsCount: 12,
    })

    const snapshot = makeSnapshot({ members: [atRiskMember] })
    const insights = await agent.analyzeGymAI(snapshot, 'gym-001')

    expect(insights.length).toBe(1)
    expect(insights[0].type).toBe('churn_risk')
    expect(insights[0].priority).toBe('high')
    expect(insights[0].memberEmail).toBe('jane@example.com')

    // Verify Claude was called
    expect(deps.claude.evaluate).toHaveBeenCalledTimes(1)
    const [system, prompt] = (deps.claude.evaluate as any).mock.calls[0]
    expect(system).toContain('AI General Manager')
    expect(prompt).toContain('Jane Smith')
  })

  it('accepts AI-assigned types not in the legacy enum', async () => {
    const aiResponse = JSON.stringify({
      insights: [
        {
          type: 'engagement_opportunity',
          priority: 'medium',
          memberId: 'member-002',
          memberName: 'Bob Builder',
          memberEmail: 'bob@example.com',
          title: 'Bob hit 100 checkins this month — celebrate!',
          detail: 'Bob is a loyal member who just hit a milestone.',
          recommendedAction: 'Send a congratulations message',
          estimatedImpact: 'Strengthens retention',
        },
      ],
    })

    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockResolvedValue(aiResponse) },
    })
    const agent = new GMAgent(deps)

    const member = makeMember({ id: 'member-002', name: 'Bob Builder', email: 'bob@example.com' })
    const snapshot = makeSnapshot({ members: [member] })
    const insights = await agent.analyzeGymAI(snapshot, 'gym-001')

    expect(insights.length).toBe(1)
    expect(insights[0].type).toBe('engagement_opportunity')
  })

  it('falls back to formula analysis when Claude fails', async () => {
    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockRejectedValue(new Error('API down')) },
    })
    const agent = new GMAgent(deps)

    const atRiskMember = makeMember({
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
    })

    const snapshot = makeSnapshot({ members: [atRiskMember] })
    const insights = await agent.analyzeGymAI(snapshot, 'gym-001')

    // Should still return formula-based insights
    expect(insights.length).toBeGreaterThan(0)
    expect(insights[0].type).toBe('churn_risk')
  })

  it('falls back to formula when Claude returns invalid JSON', async () => {
    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockResolvedValue('not json at all') },
    })
    const agent = new GMAgent(deps)

    const atRiskMember = makeMember({
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
    })

    const snapshot = makeSnapshot({ members: [atRiskMember] })
    const insights = await agent.analyzeGymAI(snapshot, 'gym-001')

    expect(insights.length).toBeGreaterThan(0)
  })

  it('merges critical members missed by AI from formula validation', async () => {
    // AI returns empty insights, but formula finds a critical member
    const aiResponse = JSON.stringify({ insights: [] })

    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockResolvedValue(aiResponse) },
    })
    const agent = new GMAgent(deps)

    const criticalMember = makeMember({
      id: 'member-critical',
      name: 'Critical Casey',
      email: 'casey@example.com',
      lastCheckinAt: daysAgo(14),
      recentCheckinsCount: 1,
      previousCheckinsCount: 10,
      renewalDate: daysFromNow(5),
    })

    const snapshot = makeSnapshot({ members: [criticalMember] })
    const insights = await agent.analyzeGymAI(snapshot, 'gym-001')

    // Formula's critical member should be merged in
    const criticalInsights = insights.filter(i => i.priority === 'critical')
    expect(criticalInsights.length).toBeGreaterThan(0)
  })

  it('includes payment events in the analysis prompt', async () => {
    const aiResponse = JSON.stringify({
      insights: [{
        type: 'payment_failed',
        priority: 'critical',
        memberId: 'member-001',
        memberName: 'Jane Smith',
        memberEmail: 'jane@example.com',
        title: 'Jane\'s payment failed',
        detail: 'Payment of $89 failed.',
        recommendedAction: 'Reach out about payment',
        estimatedImpact: '$89/mo at risk',
      }],
    })

    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockResolvedValue(aiResponse) },
    })
    const agent = new GMAgent(deps)

    const snapshot = makeSnapshot({
      members: [makeMember()],
      paymentEvents: [{
        id: 'pay-001',
        memberId: 'member-001',
        memberName: 'Jane Smith',
        memberEmail: 'jane@example.com',
        eventType: 'payment_failed',
        amount: 89,
        failedAt: daysAgo(1),
      }],
    })

    await agent.analyzeGymAI(snapshot, 'gym-001')

    const [, prompt] = (deps.claude.evaluate as any).mock.calls[0]
    expect(prompt).toContain('Payment Issues')
    expect(prompt).toContain('89')
  })
})

// ── GMAgent.runAnalysis with AI mode ─────────────────────────────────────────

describe('GMAgent.runAnalysis (AI mode)', () => {
  it('uses AI analysis by default', async () => {
    const aiResponse = JSON.stringify({
      insights: [{
        type: 'churn_risk',
        priority: 'high',
        memberId: 'member-001',
        memberName: 'Jane Smith',
        memberEmail: 'jane@example.com',
        title: 'Jane needs attention',
        detail: 'Test detail',
        recommendedAction: 'Check in',
        estimatedImpact: '$89/mo at risk',
      }],
    })

    const deps = makeDeps({
      claude: { evaluate: vi.fn().mockResolvedValue(aiResponse) },
    })
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-001' })
    agent.setCreateInsightTask(createInsightTask)

    const snapshot = makeSnapshot({
      members: [makeMember({ lastCheckinAt: daysAgo(14), recentCheckinsCount: 2, previousCheckinsCount: 12 })],
    })
    const result = await agent.runAnalysis('gym-001', snapshot)

    // AI was called (not just formula)
    expect(deps.claude.evaluate).toHaveBeenCalled()
    expect(result.insightsFound).toBe(1)
    expect(result.tasksCreated).toBe(1)
  })

  it('uses formula when useFormula option is set', async () => {
    const deps = makeDeps()
    const agent = new GMAgent(deps)
    const createInsightTask = vi.fn().mockResolvedValue({ id: 'task-001' })
    agent.setCreateInsightTask(createInsightTask)

    const snapshot = makeSnapshot({
      members: [makeMember({ lastCheckinAt: daysAgo(14), recentCheckinsCount: 2, previousCheckinsCount: 12 })],
    })
    const result = await agent.runAnalysis('gym-001', snapshot, { useFormula: true })

    // Claude should NOT have been called
    expect(deps.claude.evaluate).not.toHaveBeenCalled()
    expect(result.insightsFound).toBeGreaterThan(0)
  })
})
