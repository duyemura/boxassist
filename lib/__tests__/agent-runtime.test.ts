/**
 * agent-runtime.test.ts
 *
 * Tests for the generic agent execution engine.
 * Validates prompt assembly (4 layers), data formatting, response parsing,
 * and graceful handling of missing context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccountSnapshot } from '../agents/GMAgent'

// ── Mock skill-loader ────────────────────────────────────────────────────────

vi.mock('../skill-loader', () => ({
  loadSkillPrompt: vi.fn().mockResolvedValue('## Churn Risk Playbook\nLook for attendance drops.'),
  loadBaseContext: vi.fn().mockResolvedValue('You are an AI agent for a subscription business.'),
}))

// ── Mock memories ────────────────────────────────────────────────────────────

vi.mock('../db/memories', () => ({
  getMemoriesForPrompt: vi.fn().mockResolvedValue('## Business Context\nOwner signs off as Coach Mike.'),
}))

// ── Import after mocks ──────────────────────────────────────────────────────

import { runAgentAnalysis, formatSnapshotCompact, parseInsightsResponse } from '../agents/agent-runtime'
import { loadSkillPrompt, loadBaseContext } from '../skill-loader'
import { getMemoriesForPrompt } from '../db/memories'

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeSnapshot(overrides?: Partial<AccountSnapshot>): AccountSnapshot {
  return {
    accountId: 'acct-001',
    accountName: 'Test Gym',
    members: [
      {
        id: 'm1', name: 'Sarah Johnson', email: 'sarah@example.com',
        status: 'active', membershipType: 'Unlimited',
        memberSince: '2025-06-01', lastCheckinAt: '2026-02-08',
        recentCheckinsCount: 2, previousCheckinsCount: 12,
        monthlyRevenue: 150,
      },
      {
        id: 'm2', name: 'Mike Torres', email: 'mike@example.com',
        status: 'cancelled', membershipType: 'Monthly',
        memberSince: '2025-11-01', lastCheckinAt: '2026-01-15',
        recentCheckinsCount: 0, previousCheckinsCount: 8,
        monthlyRevenue: 99,
      },
    ],
    recentCheckins: [],
    recentLeads: [
      { id: 'l1', name: 'New Lead', email: 'lead@example.com', createdAt: '2026-02-20', status: 'new' as const },
    ],
    paymentEvents: [
      {
        id: 'p1', memberId: 'm1', memberName: 'Sarah Johnson', memberEmail: 'sarah@example.com',
        eventType: 'payment_failed' as const, amount: 150, failedAt: '2026-02-25',
      },
    ],
    capturedAt: '2026-02-26T08:00:00Z',
    ...overrides,
  }
}

const VALID_AI_RESPONSE = JSON.stringify({
  insights: [
    {
      type: 'churn_risk',
      priority: 'high',
      memberId: 'm1',
      memberName: 'Sarah Johnson',
      memberEmail: 'sarah@example.com',
      title: "Sarah hasn't visited in 18 days",
      detail: 'Her attendance dropped from 12 to 2 visits this month.',
      recommendedAction: 'Send a personal check-in message',
      estimatedImpact: '$150/mo at risk',
    },
  ],
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('agent-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('runAgentAnalysis', () => {
    it('assembles prompt with all 4 layers and calls Claude', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue(VALID_AI_RESPONSE)

      const result = await runAgentAnalysis(
        { skillType: 'at_risk_detector', accountId: 'acct-001' },
        makeSnapshot(),
        { evaluate: mockEvaluate },
      )

      // Verify Claude was called
      expect(mockEvaluate).toHaveBeenCalledTimes(1)

      // Verify the system prompt includes all layers
      const systemPrompt = mockEvaluate.mock.calls[0][0]
      expect(systemPrompt).toContain('AI agent for a subscription business') // Layer 1: base
      expect(systemPrompt).toContain('Churn Risk Playbook') // Layer 2: skill
      expect(systemPrompt).toContain('Coach Mike') // Layer 3: memories
      expect(systemPrompt).toContain('Output') // Output schema

      // Verify data prompt includes members
      const dataPrompt = mockEvaluate.mock.calls[0][1]
      expect(dataPrompt).toContain('Sarah Johnson')
      expect(dataPrompt).toContain('Test Gym')

      // Verify insights were parsed
      expect(result.insights).toHaveLength(1)
      expect(result.insights[0].memberName).toBe('Sarah Johnson')
      expect(result.insights[0].priority).toBe('high')
    })

    it('includes owner system_prompt override as Layer 4', async () => {
      const mockEvaluate = vi.fn().mockResolvedValue('{ "insights": [] }')

      await runAgentAnalysis(
        {
          skillType: 'at_risk_detector',
          accountId: 'acct-001',
          systemPromptOverride: 'Always be casual. Never offer discounts.',
        },
        makeSnapshot(),
        { evaluate: mockEvaluate },
      )

      const systemPrompt = mockEvaluate.mock.calls[0][0]
      expect(systemPrompt).toContain('Owner Instructions')
      expect(systemPrompt).toContain('Always be casual')
      expect(systemPrompt).toContain('Never offer discounts')
    })

    it('works gracefully when skill file is missing', async () => {
      vi.mocked(loadSkillPrompt).mockRejectedValueOnce(new Error('File not found'))
      const mockEvaluate = vi.fn().mockResolvedValue('{ "insights": [] }')

      const result = await runAgentAnalysis(
        { skillType: 'nonexistent_skill', accountId: 'acct-001' },
        makeSnapshot(),
        { evaluate: mockEvaluate },
      )

      // Should still call Claude (with base context only)
      expect(mockEvaluate).toHaveBeenCalledTimes(1)
      expect(result.insights).toHaveLength(0)
    })

    it('works gracefully when memories fail to load', async () => {
      vi.mocked(getMemoriesForPrompt).mockRejectedValueOnce(new Error('DB error'))
      const mockEvaluate = vi.fn().mockResolvedValue(VALID_AI_RESPONSE)

      const result = await runAgentAnalysis(
        { skillType: 'at_risk_detector', accountId: 'acct-001' },
        makeSnapshot(),
        { evaluate: mockEvaluate },
      )

      expect(result.insights).toHaveLength(1)
    })

    it('returns empty insights when Claude call fails', async () => {
      const mockEvaluate = vi.fn().mockRejectedValue(new Error('API error'))

      const result = await runAgentAnalysis(
        { skillType: 'at_risk_detector', accountId: 'acct-001' },
        makeSnapshot(),
        { evaluate: mockEvaluate },
      )

      expect(result.insights).toHaveLength(0)
    })
  })

  describe('formatSnapshotCompact', () => {
    it('includes all member data in compact format', () => {
      const prompt = formatSnapshotCompact(makeSnapshot())

      expect(prompt).toContain('Sarah Johnson')
      expect(prompt).toContain('Mike Torres')
      expect(prompt).toContain('Test Gym')
      expect(prompt).toContain('1 active')
      expect(prompt).toContain('1 ex-members')
    })

    it('includes payment issues section', () => {
      const prompt = formatSnapshotCompact(makeSnapshot())

      expect(prompt).toContain('Payment Issues')
      expect(prompt).toContain('150')
    })

    it('includes leads section', () => {
      const prompt = formatSnapshotCompact(makeSnapshot())

      expect(prompt).toContain('Prospects / Leads')
      expect(prompt).toContain('New Lead')
    })

    it('omits empty sections', () => {
      const prompt = formatSnapshotCompact(makeSnapshot({
        members: [
          {
            id: 'm1', name: 'Sarah Johnson', email: 'sarah@example.com',
            status: 'active', membershipType: 'Unlimited',
            memberSince: '2025-06-01', lastCheckinAt: '2026-02-08',
            recentCheckinsCount: 2, previousCheckinsCount: 12, monthlyRevenue: 150,
          },
        ],
        paymentEvents: [],
        recentLeads: [],
      }))

      expect(prompt).not.toContain('Payment Issues')
      expect(prompt).not.toContain('Prospects / Leads')
      expect(prompt).not.toContain('Ex-Members')
    })

    it('separates prospects from active members', () => {
      const prompt = formatSnapshotCompact(makeSnapshot({
        members: [
          {
            id: 'm1', name: 'Active Member', email: 'active@example.com',
            status: 'active', membershipType: 'Unlimited',
            memberSince: '2025-06-01', lastCheckinAt: '2026-02-20',
            recentCheckinsCount: 8, previousCheckinsCount: 10, monthlyRevenue: 150,
          },
          {
            id: 'p1', name: 'Ghost Lead', email: 'ghost@example.com',
            status: 'prospect', membershipType: null,
            memberSince: '2025-10-01', lastCheckinAt: null,
            recentCheckinsCount: 0, previousCheckinsCount: 0, monthlyRevenue: 0,
          },
        ],
        recentLeads: [],
      }))

      expect(prompt).toContain('Active Members')
      expect(prompt).toContain('Prospects / Leads')
      expect(prompt).toContain('Ghost Lead')
      expect(prompt).toContain('1 active')
      expect(prompt).toContain('1 prospects')
    })

    it('separates ex-members into their own section', () => {
      const prompt = formatSnapshotCompact(makeSnapshot({
        members: [
          {
            id: 'm1', name: 'Active Member', email: 'active@example.com',
            status: 'active', membershipType: 'Unlimited',
            memberSince: '2025-06-01', lastCheckinAt: '2026-02-20',
            recentCheckinsCount: 8, previousCheckinsCount: 10, monthlyRevenue: 150,
          },
          {
            id: 'x1', name: 'Former Member', email: 'former@example.com',
            status: 'cancelled', membershipType: 'Monthly',
            memberSince: '2025-03-01', lastCheckinAt: '2026-01-10',
            recentCheckinsCount: 0, previousCheckinsCount: 0, monthlyRevenue: 99,
          },
        ],
        recentLeads: [],
      }))

      expect(prompt).toContain('Active Members')
      expect(prompt).toContain('Ex-Members')
      expect(prompt).toContain('Former Member')
      expect(prompt).toContain('1 active')
      expect(prompt).toContain('1 ex-members')
    })
  })

  describe('parseInsightsResponse', () => {
    it('parses valid JSON response', () => {
      const insights = parseInsightsResponse(VALID_AI_RESPONSE)

      expect(insights).toHaveLength(1)
      expect(insights[0]).toEqual({
        type: 'churn_risk',
        priority: 'high',
        memberId: 'm1',
        memberName: 'Sarah Johnson',
        memberEmail: 'sarah@example.com',
        title: "Sarah hasn't visited in 18 days",
        detail: 'Her attendance dropped from 12 to 2 visits this month.',
        recommendedAction: 'Send a personal check-in message',
        estimatedImpact: '$150/mo at risk',
      })
    })

    it('handles JSON wrapped in markdown fences', () => {
      const wrapped = '```json\n' + VALID_AI_RESPONSE + '\n```'
      const insights = parseInsightsResponse(wrapped)

      expect(insights).toHaveLength(1)
    })

    it('defaults invalid priority to medium', () => {
      const response = JSON.stringify({
        insights: [{ type: 'test', priority: 'urgent', memberId: 'm1', memberName: 'Test' }],
      })
      const insights = parseInsightsResponse(response)

      expect(insights[0].priority).toBe('medium')
    })

    it('returns empty array for non-JSON response', () => {
      const insights = parseInsightsResponse('I could not analyze the data.')

      expect(insights).toHaveLength(0)
    })

    it('returns empty array for malformed JSON', () => {
      const insights = parseInsightsResponse('{ broken json')

      expect(insights).toHaveLength(0)
    })

    it('handles empty insights array', () => {
      const insights = parseInsightsResponse('{ "insights": [] }')

      expect(insights).toHaveLength(0)
    })

    it('handles response with text before JSON', () => {
      const response = 'Here is my analysis:\n\n' + VALID_AI_RESPONSE
      const insights = parseInsightsResponse(response)

      expect(insights).toHaveLength(1)
    })
  })
})
