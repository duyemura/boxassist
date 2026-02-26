/**
 * attribute-outcomes.test.ts
 *
 * Tests for GET /api/cron/attribute-outcomes.
 * Verifies:
 *   - Auth: rejects requests without valid CRON_SECRET
 *   - Happy path: attributes 'engaged' when ppGet returns a matching checkin
 *   - Filters checkins by c.customer === task.member_id
 *   - Expiry: sets 'unresponsive' when 14-day window expires with no checkin
 *   - Skips tasks without pushpress_api_key
 *   - Handles PushPress API errors gracefully
 *   - Decrypts API key before calling ppGet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockTasks: any[] = []
let mockUpdateCalls: Array<{ id: string; update: Record<string, any> }> = []

function makeChain(resolvedData: any) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'lt', 'lte',
    'single', 'limit', 'order', 'filter',
  ]

  // Track update calls to verify attribution writes
  let pendingUpdate: Record<string, any> | null = null

  methods.forEach(m => {
    if (m === 'update') {
      obj[m] = vi.fn((data: any) => {
        pendingUpdate = data
        return obj
      })
    } else if (m === 'eq') {
      obj[m] = vi.fn((col: string, val: any) => {
        if (pendingUpdate && col === 'id') {
          mockUpdateCalls.push({ id: val, update: pendingUpdate })
          pendingUpdate = null
        }
        return obj
      })
    } else {
      obj[m] = vi.fn().mockReturnValue(obj)
    }
  })
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

// Mock decrypt — returns the input for test simplicity
vi.mock('@/lib/encrypt', () => ({
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
}))

// Mock ppGet — the Platform API v1 client
const mockPpGet = vi.fn()
vi.mock('@/lib/pushpress-platform', () => ({
  ppGet: (...args: any[]) => mockPpGet(...args),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {}
  if (secret) headers.authorization = `Bearer ${secret}`
  return new NextRequest('http://localhost:3000/api/cron/attribute-outcomes', { headers })
}

function makeTaskWithGym(overrides: Record<string, any> = {}) {
  return {
    id: 'task-001',
    account_id: 'gym-001',
    status: 'awaiting_reply',
    outcome: null,
    member_email: 'dan@example.com',
    member_id: 'member-001',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    gyms: {
      pushpress_api_key: 'pp-key-123',
      pushpress_company_id: 'company-001',
      avg_membership_price: 175,
    },
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/cron/attribute-outcomes', () => {
  let handler: typeof import('@/app/api/cron/attribute-outcomes/route').GET

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockTasks = []
    mockUpdateCalls = []
    mockPpGet.mockReset()
    const mod = await import('@/app/api/cron/attribute-outcomes/route')
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

  it('returns zero counts when no tasks need attribution', async () => {
    mockTasks = []
    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.checked).toBe(0)
    expect(body.attributed).toBe(0)
    expect(body.expired).toBe(0)
  })

  it('attributes "engaged" when ppGet returns a matching checkin', async () => {
    const task = makeTaskWithGym()
    mockTasks = [task]

    // ppGet returns checkins — one matches the task's member_id
    mockPpGet.mockResolvedValue([
      { id: 'checkin-1', customer: 'member-001', timestamp: Date.now() },
    ])

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.checked).toBe(1)
    expect(body.attributed).toBe(1)
    expect(body.expired).toBe(0)
  })

  it('calls ppGet with correct Platform v1 params', async () => {
    const task = makeTaskWithGym()
    mockTasks = [task]
    mockPpGet.mockResolvedValue([])

    await handler(makeRequest('test-cron-secret'))

    expect(mockPpGet).toHaveBeenCalledTimes(1)
    const [apiKey, path, params, companyId] = mockPpGet.mock.calls[0]
    expect(apiKey).toBe('decrypted-pp-key-123')
    expect(path).toBe('/checkins')
    expect(params.startTimestamp).toBeDefined()
    expect(params.endTimestamp).toBeDefined()
    expect(companyId).toBe('company-001')
  })

  it('filters checkins by c.customer === task.member_id', async () => {
    const task = makeTaskWithGym({ member_id: 'member-001' })
    mockTasks = [task]

    // ppGet returns checkins for a DIFFERENT member — should NOT attribute
    mockPpGet.mockResolvedValue([
      { id: 'checkin-1', customer: 'member-OTHER', timestamp: Date.now() },
    ])

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.attributed).toBe(0)
  })

  it('marks "unresponsive" when 14-day window expires with no checkin', async () => {
    const task = makeTaskWithGym({
      created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
    })
    mockTasks = [task]

    // No matching checkins
    mockPpGet.mockResolvedValue([])

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.checked).toBe(1)
    expect(body.attributed).toBe(0)
    expect(body.expired).toBe(1)
  })

  it('skips tasks without pushpress_api_key', async () => {
    const task = makeTaskWithGym({
      gyms: { pushpress_api_key: null, pushpress_company_id: null, avg_membership_price: 150 },
    })
    mockTasks = [task]

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.checked).toBe(1)
    expect(body.attributed).toBe(0)
    expect(body.expired).toBe(0)
    expect(mockPpGet).not.toHaveBeenCalled()
  })

  it('handles PushPress API error gracefully without crashing', async () => {
    const task = makeTaskWithGym()
    mockTasks = [task]

    mockPpGet.mockRejectedValue(new Error('Network timeout'))

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.checked).toBe(1)
    expect(body.attributed).toBe(0)
  })

  it('does not attribute tasks within window that have no checkin yet', async () => {
    const task = makeTaskWithGym({
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    })
    mockTasks = [task]

    // No matching checkins
    mockPpGet.mockResolvedValue([])

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    // Within window, no checkin → neither attributed nor expired
    expect(body.attributed).toBe(0)
    expect(body.expired).toBe(0)
  })

  it('uses gym avg_membership_price for attribution value', async () => {
    const task = makeTaskWithGym({
      gyms: { pushpress_api_key: 'key', pushpress_company_id: 'co', avg_membership_price: 225 },
    })
    mockTasks = [task]

    mockPpGet.mockResolvedValue([
      { id: 'checkin-1', customer: 'member-001', timestamp: Date.now() },
    ])

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.attributed).toBe(1)
    // Verify the update call used the correct price
    const engagedUpdate = mockUpdateCalls.find(c => c.update.outcome === 'engaged')
    expect(engagedUpdate?.update.attributed_value).toBe(225)
  })

  it('defaults to $150 when gym has no avg_membership_price', async () => {
    const task = makeTaskWithGym({
      gyms: { pushpress_api_key: 'key', pushpress_company_id: 'co', avg_membership_price: null },
    })
    mockTasks = [task]

    mockPpGet.mockResolvedValue([
      { id: 'checkin-1', customer: 'member-001', timestamp: Date.now() },
    ])

    const res = await handler(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.attributed).toBe(1)
    const engagedUpdate = mockUpdateCalls.find(c => c.update.outcome === 'engaged')
    expect(engagedUpdate?.update.attributed_value).toBe(150)
  })
})
