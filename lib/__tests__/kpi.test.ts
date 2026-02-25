/**
 * kpi.test.ts
 *
 * Unit tests for getMonthlyRetentionROI in lib/db/kpi.ts.
 * Tests the aggregation logic for tasks created, retained, churned, etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockTasks = [
  { id: 't1', status: 'resolved', outcome: 'engaged', attributed_value: 150, created_at: '2026-02-10T00:00:00Z' },
  { id: 't2', status: 'resolved', outcome: 'engaged', attributed_value: 175, created_at: '2026-02-12T00:00:00Z' },
  { id: 't3', status: 'resolved', outcome: 'churned', attributed_value: null, created_at: '2026-02-14T00:00:00Z' },
  { id: 't4', status: 'awaiting_reply', outcome: null, attributed_value: null, created_at: '2026-02-15T00:00:00Z' },
  { id: 't5', status: 'escalated', outcome: null, attributed_value: null, created_at: '2026-02-16T00:00:00Z' },
  { id: 't6', status: 'resolved', outcome: 'recovered', attributed_value: 450, created_at: '2026-02-20T00:00:00Z' },
]

let mockTasksResponse: any = { data: mockTasks, error: null }
let mockConversationCount = 8

function makeChain(resolvedData: any) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'lt', 'lte',
    'single', 'limit', 'order', 'filter',
  ]
  methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
  obj.then = (resolve: any) => resolve(resolvedData)
  return obj
}

vi.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'agent_tasks') return makeChain(mockTasksResponse)
      if (table === 'task_conversations') return makeChain({ count: mockConversationCount, data: null, error: null })
      return makeChain({ data: null, error: null })
    }),
  },
}))

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getMonthlyRetentionROI', () => {
  let getMonthlyRetentionROI: typeof import('@/lib/db/kpi').getMonthlyRetentionROI

  beforeEach(async () => {
    vi.resetModules()
    mockTasksResponse = { data: mockTasks, error: null }
    mockConversationCount = 8
    const mod = await import('../db/kpi')
    getMonthlyRetentionROI = mod.getMonthlyRetentionROI
  })

  it('counts tasks created in the month', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.tasksCreated).toBe(6)
  })

  it('sums messages sent from task_conversations', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.messagesSent).toBe(8)
  })

  it('counts retained members (engaged + recovered outcomes)', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.membersRetained).toBe(3) // t1 engaged + t2 engaged + t6 recovered
  })

  it('sums attributed revenue from retained members', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.revenueRetained).toBe(775) // 150 + 175 + 450
  })

  it('counts churned members', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.membersChurned).toBe(1)
  })

  it('counts active conversations (awaiting_reply + in_progress)', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.conversationsActive).toBe(1) // t4 awaiting_reply
  })

  it('counts escalations', async () => {
    const result = await getMonthlyRetentionROI('gym-1', '2026-02')
    expect(result.escalations).toBe(1) // t5 escalated
  })

  it('handles empty tasks gracefully', async () => {
    mockTasksResponse = { data: [], error: null }
    // Re-import to get fresh reference with new mock
    vi.resetModules()
    const mod = await import('../db/kpi')
    const result = await mod.getMonthlyRetentionROI('gym-1', '2026-02')

    expect(result.tasksCreated).toBe(0)
    expect(result.messagesSent).toBe(0)
    expect(result.membersRetained).toBe(0)
    expect(result.revenueRetained).toBe(0)
  })

  it('handles null tasks data gracefully', async () => {
    mockTasksResponse = { data: null, error: null }
    vi.resetModules()
    const mod = await import('../db/kpi')
    const result = await mod.getMonthlyRetentionROI('gym-1', '2026-02')

    expect(result.tasksCreated).toBe(0)
    expect(result.membersRetained).toBe(0)
  })
})
