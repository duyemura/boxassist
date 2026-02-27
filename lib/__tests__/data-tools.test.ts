/**
 * data-tools.test.ts
 *
 * Tests for read-only data tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockPpGet = vi.fn()
vi.mock('../pushpress-platform', () => ({
  ppGet: (...args: unknown[]) => mockPpGet(...args),
  buildMemberData: vi.fn((customer, enrollment, checkins, now, revenue) => ({
    id: customer.id,
    name: `${customer.name.first} ${customer.name.last}`.trim(),
    email: customer.email,
    status: enrollment?.status === 'canceled' ? 'cancelled' : 'active',
    membershipType: 'Unlimited',
    memberSince: '2025-01-01',
    lastCheckinAt: checkins.length > 0 ? new Date((checkins[0] as any).timestamp * 1000).toISOString() : undefined,
    recentCheckinsCount: checkins.filter((c: any) => c.timestamp > (Date.now() / 1000 - 30 * 86400)).length,
    previousCheckinsCount: 0,
    monthlyRevenue: revenue ?? 0,
  })),
}))

const mockGetOpenTasksForGym = vi.fn()
vi.mock('../db/tasks', () => ({
  getOpenTasksForGym: (...args: unknown[]) => mockGetOpenTasksForGym(...args),
}))

const mockGetAccountMemories = vi.fn()
vi.mock('../db/memories', () => ({
  getAccountMemories: (...args: unknown[]) => mockGetAccountMemories(...args),
}))

// Chainable mock builder — terminal methods resolve a value
function chainable(resolveValue: unknown) {
  const chain: any = new Proxy({}, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch') return undefined
      // Terminal methods that resolve
      if (['limit', 'single', 'maybeSingle'].includes(prop as string)) {
        return vi.fn().mockResolvedValue(resolveValue)
      }
      // Chain methods return the chain
      return vi.fn().mockReturnValue(chain)
    }
  })
  return chain
}

const mockSupabaseFrom = vi.fn()
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { dataToolGroup } from '../agents/tools/data-tools'
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
  const tool = dataToolGroup.tools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('data tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('get_members', () => {
    it('returns filtered members with compact summary', async () => {
      const tool = findTool('get_members')

      mockPpGet
        .mockResolvedValueOnce([
          { id: 'm1', uuid: 'm1', name: { first: 'Sarah', last: 'J' }, email: 'sarah@test.com', role: 'member' },
          { id: 'm2', uuid: 'm2', name: { first: 'Mike', last: 'T' }, email: 'mike@test.com', role: 'member' },
        ])
        .mockResolvedValueOnce([]) // enrollments
        .mockResolvedValueOnce([]) // checkins

      const result = await tool.execute({ limit: 10 }, makeCtx())
      const r = result as any
      expect(r.members).toBeDefined()
      expect(r.total_matching).toBeGreaterThanOrEqual(0)
      expect(r.returned).toBeGreaterThanOrEqual(0)
    })

    it('excludes already-processed members', async () => {
      const tool = findTool('get_members')

      mockPpGet
        .mockResolvedValueOnce([
          { id: 'm1', uuid: 'm1', name: { first: 'Sarah', last: 'J' }, email: 'sarah@test.com' },
          { id: 'm2', uuid: 'm2', name: { first: 'Mike', last: 'T' }, email: 'mike@test.com' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const ctx = makeCtx({ workingSet: { processed: ['m1'], emailed: [], skipped: [] } })
      const result = await tool.execute({}, ctx) as any

      expect(result.excluded_already_processed).toBe(1)
    })

    it('handles PushPress API errors gracefully', async () => {
      const tool = findTool('get_members')
      mockPpGet.mockRejectedValueOnce(new Error('API down'))

      const result = await tool.execute({}, makeCtx()) as any
      expect(result.error).toContain('Failed to fetch members')
    })

    it('never requires approval', () => {
      const tool = findTool('get_members')
      expect(tool.requiresApproval).toBe(false)
    })
  })

  describe('get_member_detail', () => {
    it('returns member profile when found', async () => {
      const tool = findTool('get_member_detail')

      mockPpGet
        .mockResolvedValueOnce([{ id: 'm1', uuid: 'm1', name: { first: 'Sarah', last: 'J' }, email: 'sarah@test.com' }])
        .mockResolvedValueOnce([]) // checkins

      mockSupabaseFrom.mockReturnValue(chainable({ data: [], error: null }))

      const result = await tool.execute({ member_id: 'm1' }, makeCtx()) as any
      expect(result.id).toBe('m1')
      expect(result.name).toBe('Sarah J')
    })

    it('handles not found', async () => {
      const tool = findTool('get_member_detail')
      mockPpGet.mockResolvedValueOnce([])

      const result = await tool.execute({ member_id: 'missing' }, makeCtx()) as any
      expect(result.error).toContain('not found')
    })
  })

  describe('get_open_tasks', () => {
    it('returns open tasks for the account', async () => {
      const tool = findTool('get_open_tasks')

      mockGetOpenTasksForGym.mockResolvedValue([
        {
          id: 't1', task_type: 'churn_risk', member_name: 'Sarah',
          member_email: 'sarah@test.com', status: 'open', goal: 'Check on Sarah',
          context: { priority: 'high' }, created_at: '2026-02-27',
        },
      ])

      const result = await tool.execute({}, makeCtx()) as any
      expect(result.count).toBe(1)
      expect(result.tasks[0].type).toBe('churn_risk')
    })
  })

  describe('get_memories', () => {
    it('returns filtered memories', async () => {
      const tool = findTool('get_memories')

      mockGetAccountMemories.mockResolvedValue([
        {
          id: 'mem1', category: 'preference', content: 'Sign off as Coach Mike',
          importance: 5, scope: 'global', member_id: null, source: 'owner',
        },
      ])

      const result = await tool.execute({ category: 'preference' }, makeCtx()) as any
      expect(result.count).toBe(1)
      expect(result.memories[0].content).toBe('Sign off as Coach Mike')
    })
  })

  describe('get_checkins', () => {
    it('filters to valid attendee checkins', async () => {
      const tool = findTool('get_checkins')

      mockPpGet.mockResolvedValueOnce([
        { id: 'c1', customer: 'm1', timestamp: Math.floor(Date.now() / 1000), kind: 'class', role: 'attendee', result: 'success' },
        { id: 'c2', customer: 'm1', timestamp: Math.floor(Date.now() / 1000), kind: 'class', role: 'coach', result: 'success' },
      ])

      const result = await tool.execute({ days_back: 7 }, makeCtx()) as any
      expect(result.total).toBe(1) // only the attendee one
    })
  })

  describe('get_classes', () => {
    it('returns classes from PushPress', async () => {
      const tool = findTool('get_classes')

      mockPpGet.mockResolvedValueOnce([
        { id: 'cl1', name: 'CrossFit WOD', capacity: 20, enrolled: 12 },
      ])

      const result = await tool.execute({}, makeCtx()) as any
      expect(result.count).toBe(1)
      expect(result.classes[0].name).toBe('CrossFit WOD')
    })
  })

  describe('get_data_lenses', () => {
    it('queries data_lens memories', async () => {
      const tool = findTool('get_data_lenses')

      mockSupabaseFrom.mockReturnValue(chainable({
        data: [{ id: 'dl1', content: 'Active members: 150', created_at: '2026-02-27' }],
        error: null,
      }))

      const result = await tool.execute({}, makeCtx()) as any
      expect(result.count).toBe(1)
      expect(result.lenses[0].content).toBe('Active members: 150')
    })
  })

  describe('tool group', () => {
    it('has all 7 expected tools', () => {
      expect(dataToolGroup.tools).toHaveLength(7)
      const names = dataToolGroup.tools.map(t => t.name)
      expect(names).toContain('get_members')
      expect(names).toContain('get_member_detail')
      expect(names).toContain('get_open_tasks')
      expect(names).toContain('get_memories')
      expect(names).toContain('get_checkins')
      expect(names).toContain('get_classes')
      expect(names).toContain('get_data_lenses')
    })

    it('none require approval', () => {
      for (const tool of dataToolGroup.tools) {
        expect(tool.requiresApproval).toBe(false)
      }
    })
  })
})
