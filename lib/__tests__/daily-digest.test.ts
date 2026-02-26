/**
 * daily-digest.test.ts
 *
 * Tests for GET /api/cron/daily-digest.
 * Verifies:
 *   - Auth: 401 without valid CRON_SECRET
 *   - Skips accounts with 0 pending tasks (no email sent)
 *   - Sends email when pending tasks exist
 *   - Uses correct account name in template
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockTeamMembers: any[] = []
let mockPendingTasks: any[] = []
const mockEmailSend = vi.fn().mockResolvedValue({ data: { id: 'email-1' } })

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockEmailSend }
  },
}))

vi.mock('@/lib/db/kpi', () => ({
  getMonthlyRetentionROI: vi.fn().mockResolvedValue({
    membersRetained: 3,
    revenueRetained: 450,
    messagesSent: 8,
    conversationsActive: 2,
    escalations: 0,
  }),
}))

// Track which table is being queried for fine-grained mock control
function makeChain(resolvedData: any) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter',
  ]
  methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
  obj.then = (resolve: any) => resolve(resolvedData)
  return obj
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'team_members') {
        return makeChain({ data: mockTeamMembers, error: null })
      }
      if (table === 'agent_tasks') {
        return makeChain({ data: mockPendingTasks, error: null })
      }
      return makeChain({ data: null, error: null })
    }),
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {}
  if (secret) headers.authorization = `Bearer ${secret}`
  return new NextRequest('http://localhost:3000/api/cron/daily-digest', { headers })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/cron/daily-digest', () => {
  let handler: typeof import('@/app/api/cron/daily-digest/route').GET

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockTeamMembers = []
    mockPendingTasks = []
    mockEmailSend.mockClear()
    const mod = await import('@/app/api/cron/daily-digest/route')
    handler = mod.GET
  })

  it('returns 401 without valid CRON_SECRET', async () => {
    const res = await handler(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns 401 with no authorization header', async () => {
    const res = await handler(makeRequest())
    expect(res.status).toBe(401)
  })

  it('skips accounts with 0 pending tasks', async () => {
    mockTeamMembers = [{
      user_id: 'user-001',
      accounts: { id: 'gym-001', account_name: 'Iron Temple', pushpress_api_key: 'key' },
      users: { email: 'owner@gym.com' },
    }]
    mockPendingTasks = [] // zero pending

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sent).toBe(0)
    expect(mockEmailSend).not.toHaveBeenCalled()
  })

  it('sends email when pending tasks exist', async () => {
    mockTeamMembers = [{
      user_id: 'user-001',
      accounts: { id: 'gym-001', account_name: 'Iron Temple', pushpress_api_key: 'key' },
      users: { email: 'owner@gym.com' },
    }]
    mockPendingTasks = [
      { id: 'task-1', member_name: 'Alex', status: 'open' },
      { id: 'task-2', member_name: 'Sam', status: 'awaiting_approval' },
    ]

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sent).toBe(1)
    expect(mockEmailSend).toHaveBeenCalledTimes(1)
    expect(mockEmailSend.mock.calls[0][0].to).toBe('owner@gym.com')
  })

  it('uses correct account name in email template', async () => {
    mockTeamMembers = [{
      user_id: 'user-001',
      accounts: { id: 'gym-001', account_name: 'CrossFit Downtown', pushpress_api_key: 'key' },
      users: { email: 'owner@cf.com' },
    }]
    mockPendingTasks = [
      { id: 'task-1', member_name: 'Jordan', status: 'open' },
    ]

    await handler(makeRequest('test-cron-secret'))

    const emailHtml = mockEmailSend.mock.calls[0][0].html as string
    expect(emailHtml).toContain('CrossFit Downtown')
  })

  it('includes escalation count in subject when escalations exist', async () => {
    mockTeamMembers = [{
      user_id: 'user-001',
      accounts: { id: 'gym-001', account_name: 'Iron Temple', pushpress_api_key: 'key' },
      users: { email: 'owner@gym.com' },
    }]
    mockPendingTasks = [
      { id: 'task-1', member_name: 'Alex', status: 'escalated' },
      { id: 'task-2', member_name: 'Sam', status: 'open' },
    ]

    await handler(makeRequest('test-cron-secret'))

    const emailSubject = mockEmailSend.mock.calls[0][0].subject as string
    expect(emailSubject).toContain('1 escalation')
  })

  it('returns ok with 0 sent when no team members found', async () => {
    mockTeamMembers = []

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sent).toBe(0)
  })
})
