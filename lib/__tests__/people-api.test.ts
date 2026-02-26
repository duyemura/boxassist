/**
 * people-api.test.ts
 *
 * Tests for GET /api/retention/members (People API).
 * Verifies:
 *   - Auth: rejects unauthenticated requests
 *   - Demo: returns sample data for demo sessions
 *   - Happy path: maps agent_tasks to abstract PersonRow shape
 *   - Handles missing context gracefully
 *   - No hardcoded domain-specific fields (no riskLevel, lastCheckin)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockSession: any = null
let mockAccount: any = null
let mockTasks: any[] = []

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

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'agent_tasks') {
        return makeChain({ data: mockTasks, error: null })
      }
      return makeChain({ data: null, error: null })
    }),
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockSession),
}))

vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: vi.fn(() => mockAccount),
}))

// ── Import route after mocks ─────────────────────────────────────────────────

import { GET } from '@/app/api/retention/members/route'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/retention/members')
}

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: 'task-1',
    member_name: 'Alex Martinez',
    member_email: 'alex@example.com',
    status: 'open',
    outcome: null,
    task_type: 'attendance_drop',
    goal: 'Re-engage Alex — attendance declining',
    priority: 'high',
    context: {
      detail: 'Alex has not visited in 14 days, down from 4x/week.',
      recommendedAction: 'Send a personal check-in',
      estimatedImpact: '$175/mo at risk',
    },
    created_at: '2026-02-20T00:00:00Z',
    updated_at: '2026-02-25T00:00:00Z',
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/retention/members', () => {
  beforeEach(() => {
    mockSession = null
    mockAccount = null
    mockTasks = []
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns demo data for demo sessions', async () => {
    mockSession = { id: 'demo', isDemo: true }
    const res = await GET(makeRequest())
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)

    // Demo data should use abstract shape — no riskLevel or lastCheckin
    const first = data[0]
    expect(first).toHaveProperty('priority')
    expect(first).toHaveProperty('taskType')
    expect(first).toHaveProperty('title')
    expect(first).toHaveProperty('detail')
    expect(first).not.toHaveProperty('riskLevel')
    expect(first).not.toHaveProperty('lastCheckin')
  })

  it('returns 400 when no account connected', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = null
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
  })

  it('maps agent_tasks to abstract PersonRow shape', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = { id: 'account-1' }
    mockTasks = [makeTask()]

    const res = await GET(makeRequest())
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toHaveLength(1)

    const row = data[0]
    expect(row.id).toBe('task-1')
    expect(row.name).toBe('Alex Martinez')
    expect(row.email).toBe('alex@example.com')
    expect(row.priority).toBe('high')
    expect(row.status).toBe('open')
    expect(row.taskType).toBe('attendance_drop')
    expect(row.title).toBe('Re-engage Alex — attendance declining')
    expect(row.detail).toBe('Alex has not visited in 14 days, down from 4x/week.')
    expect(row.recommendedAction).toBe('Send a personal check-in')
    expect(row.estimatedImpact).toBe('$175/mo at risk')
    expect(row.createdAt).toBe('2026-02-20T00:00:00Z')
    expect(row.updatedAt).toBe('2026-02-25T00:00:00Z')
  })

  it('does not include hardcoded domain-specific fields', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = { id: 'account-1' }
    mockTasks = [makeTask()]

    const res = await GET(makeRequest())
    const data = await res.json()
    const row = data[0]

    // These are hardcoded gym-specific fields that should NOT exist
    expect(row).not.toHaveProperty('riskLevel')
    expect(row).not.toHaveProperty('lastCheckin')
  })

  it('handles tasks with minimal context', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = { id: 'account-1' }
    mockTasks = [makeTask({
      member_name: null,
      goal: null,
      context: {},
    })]

    const res = await GET(makeRequest())
    const data = await res.json()
    const row = data[0]

    expect(row.name).toBe('Unknown')
    expect(row.title).toBeNull()
    expect(row.detail).toBeNull()
    expect(row.recommendedAction).toBeNull()
  })

  it('falls back to context fields for legacy data', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = { id: 'account-1' }
    mockTasks = [makeTask({
      member_name: null,
      task_type: null,
      goal: null,
      priority: null,
      context: {
        memberName: 'Legacy Name',
        memberEmail: 'legacy@example.com',
        insightType: 'churn_risk',
        priority: 'medium',
        riskReason: 'Legacy risk reason',
        insights: 'Legacy insights text',
      },
    })]

    const res = await GET(makeRequest())
    const data = await res.json()
    const row = data[0]

    expect(row.name).toBe('Legacy Name')
    expect(row.priority).toBe('medium')
    expect(row.taskType).toBe('churn_risk')
    // detail falls back through: ctx.detail → ctx.insights → ctx.riskReason
    expect(row.detail).toBe('Legacy insights text')
  })

  it('returns empty array when no tasks exist', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = { id: 'account-1' }
    mockTasks = []

    const res = await GET(makeRequest())
    const data = await res.json()

    expect(data).toEqual([])
  })

  it('maps multiple tasks correctly', async () => {
    mockSession = { id: 'user-1' }
    mockAccount = { id: 'account-1' }
    mockTasks = [
      makeTask({ id: 'task-1', member_name: 'Alice', priority: 'critical' }),
      makeTask({ id: 'task-2', member_name: 'Bob', priority: 'low', status: 'resolved', outcome: 'engaged' }),
    ]

    const res = await GET(makeRequest())
    const data = await res.json()

    expect(data).toHaveLength(2)
    expect(data[0].name).toBe('Alice')
    expect(data[0].priority).toBe('critical')
    expect(data[1].name).toBe('Bob')
    expect(data[1].outcome).toBe('engaged')
  })
})
