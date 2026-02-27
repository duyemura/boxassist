/**
 * learning-tools.test.ts
 *
 * Tests for the suggest_improvement learning tool:
 * confidence threshold, deduplication, rate limiting, sensitivity.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockSupabaseFrom = vi.fn()
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { learningToolGroup } from '../agents/tools/learning-tools'
import type { ToolContext } from '../agents/tools/types'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    accountId: 'acct-001',
    apiKey: 'test-key',
    companyId: 'test-company',
    sessionId: 'session-001',
    autopilotLevel: 'smart',
    autonomyMode: 'semi_auto',
    workingSet: { processed: [], emailed: [], skipped: [] },
    ...overrides,
  }
}

function findTool(name: string) {
  const tool = learningToolGroup.tools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

function chainable(resolveValue: unknown) {
  const chain: any = {}
  const methods = ['select', 'eq', 'in', 'limit', 'insert', 'single', 'gte', 'order', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal: make it resolve
  chain.limit = vi.fn().mockResolvedValue(resolveValue)
  chain.single = vi.fn().mockResolvedValue(resolveValue)
  chain.maybeSingle = vi.fn().mockResolvedValue(resolveValue)
  return chain
}

function setupMocks(opts?: { sensitivity?: number; insertResult?: any }) {
  const sensitivity = opts?.sensitivity ?? 60

  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'accounts') {
      return chainable({
        data: { improvement_sensitivity: sensitivity },
        error: null,
      })
    }
    if (table === 'improvement_suggestions') {
      // Need to handle both select (dedup) and insert paths
      const selectChain: any = {}
      const insertChain: any = {}

      // select path: .select().eq().eq().in().limit()
      selectChain.limit = vi.fn().mockResolvedValue({ data: [], error: null })
      selectChain.in = vi.fn().mockReturnValue(selectChain)
      selectChain.eq = vi.fn().mockReturnValue(selectChain)
      selectChain.select = vi.fn().mockReturnValue(selectChain)

      // insert path: .insert().select().single()
      insertChain.single = vi.fn().mockResolvedValue(
        opts?.insertResult ?? { data: { id: 'imp-1' }, error: null },
      )
      insertChain.select = vi.fn().mockReturnValue(insertChain)
      insertChain.insert = vi.fn().mockReturnValue(insertChain)

      return {
        select: selectChain.select,
        insert: insertChain.insert,
      }
    }
    return chainable({ data: null, error: null })
  })
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('learning tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('suggest_improvement', () => {
    it('stores a valid improvement suggestion', async () => {
      const tool = findTool('suggest_improvement')
      setupMocks()

      const result = await tool.execute(
        {
          type: 'memory',
          description: 'Members with 3+ weekly visits never churn',
          proposed_change: 'Members with 3+ weekly visits are low churn risk',
          source: 'observation',
          confidence: 85,
          evidence: 'Analyzed 50 members over 6 months',
        },
        makeCtx(),
      ) as any

      expect(result.noted).toBe(true)
      expect(result.improvementId).toBe('imp-1')
      expect(result.status).toBe('pending')
    })

    it('drops suggestions below confidence threshold', async () => {
      const tool = findTool('suggest_improvement')
      setupMocks({ sensitivity: 80 })

      const result = await tool.execute(
        {
          type: 'memory',
          description: 'Maybe something',
          proposed_change: 'Something vague',
          source: 'observation',
          confidence: 50, // below 80 threshold
        },
        makeCtx(),
      ) as any

      expect(result.noted).toBe(false)
      expect(result.reason).toContain('below threshold')
    })

    it('respects rate limit of 3 per session', async () => {
      const tool = findTool('suggest_improvement')
      setupMocks()

      const ctx = makeCtx()

      // First 3 should succeed
      for (let i = 0; i < 3; i++) {
        setupMocks() // Re-setup so insert mock is fresh
        const result = await tool.execute(
          {
            type: 'memory',
            description: `Improvement ${i}`,
            proposed_change: `Change ${i}`,
            source: 'observation',
            confidence: 90,
          },
          ctx,
        ) as any

        expect(result.noted).toBe(true)
      }

      // 4th should be rate limited
      const result = await tool.execute(
        {
          type: 'memory',
          description: 'One too many',
          proposed_change: 'Should not store',
          source: 'observation',
          confidence: 90,
        },
        ctx,
      ) as any

      expect(result.noted).toBe(false)
      expect(result.reason).toContain('limit reached')
    })

    it('uses default sensitivity when account has none', async () => {
      const tool = findTool('suggest_improvement')

      // Account query returns null (no record)
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'accounts') {
          return chainable({
            data: null,
            error: { code: 'PGRST116', message: 'not found' },
          })
        }
        if (table === 'improvement_suggestions') {
          const selectChain: any = {}
          const insertChain: any = {}

          selectChain.limit = vi.fn().mockResolvedValue({ data: [], error: null })
          selectChain.in = vi.fn().mockReturnValue(selectChain)
          selectChain.eq = vi.fn().mockReturnValue(selectChain)
          selectChain.select = vi.fn().mockReturnValue(selectChain)

          insertChain.single = vi.fn().mockResolvedValue({ data: { id: 'imp-2' }, error: null })
          insertChain.select = vi.fn().mockReturnValue(insertChain)
          insertChain.insert = vi.fn().mockReturnValue(insertChain)

          return {
            select: selectChain.select,
            insert: insertChain.insert,
          }
        }
        return chainable({ data: null, error: null })
      })

      // confidence 65 > default 60, should pass
      const result = await tool.execute(
        {
          type: 'memory',
          description: 'Something',
          proposed_change: 'A change',
          source: 'observation',
          confidence: 65,
        },
        makeCtx(),
      ) as any

      expect(result.noted).toBe(true)
    })

    it('never requires approval', () => {
      const tool = findTool('suggest_improvement')
      expect(tool.requiresApproval).toBe(false)
    })

    it('handles DB insert errors', async () => {
      const tool = findTool('suggest_improvement')
      setupMocks({ insertResult: { data: null, error: { message: 'DB write failed' } } })

      const result = await tool.execute(
        {
          type: 'memory',
          description: 'Test',
          proposed_change: 'Test change',
          source: 'observation',
          confidence: 90,
        },
        makeCtx(),
      ) as any

      expect(result.error).toContain('Failed to store improvement')
    })
  })

  describe('tool group', () => {
    it('has 1 tool', () => {
      expect(learningToolGroup.tools).toHaveLength(1)
    })

    it('is named learning', () => {
      expect(learningToolGroup.name).toBe('learning')
    })
  })
})
