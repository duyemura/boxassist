/**
 * retention-api.test.ts
 *
 * Unit tests for the Retention Machine API endpoints:
 *   - /api/retention/scorecard
 *   - /api/retention/activity
 *   - /api/retention/members
 *   - /api/settings/autopilot
 *
 * Tests auth, happy path, demo mode, and error cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockSession: any = null
const mockSupabaseChain: any = {}

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockSession),
}))

// Build a chainable supabase mock that resolves to configurable data
function makeChain(resolvedData: { data: any; error: any; count?: number }) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter',
  ]
  methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
  obj.then = (resolve: any) => resolve(resolvedData)
  return obj
}

let fromResponses: Record<string, { data: any; error: any; count?: number }> = {}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeChain(
      fromResponses[table] ?? { data: null, error: null }
    )),
  },
}))

vi.mock('@/lib/db/kpi', () => ({
  getMonthlyRetentionROI: vi.fn().mockResolvedValue({
    tasksCreated: 10,
    messagesSent: 14,
    membersRetained: 5,
    revenueRetained: 750,
    membersChurned: 1,
    conversationsActive: 3,
    escalations: 0,
  }),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(path: string, options?: RequestInit) {
  return new NextRequest(`http://localhost:3000${path}`, options)
}

// ── Scorecard Endpoint ───────────────────────────────────────────────────────

describe('GET /api/retention/scorecard', () => {
  let handler: typeof import('@/app/api/retention/scorecard/route').GET

  beforeEach(async () => {
    vi.resetModules()
    mockSession = null
    fromResponses = {}
    const mod = await import('@/app/api/retention/scorecard/route')
    handler = mod.GET
  })

  it('returns 401 when not authenticated', async () => {
    mockSession = null
    const res = await handler(makeRequest('/api/retention/scorecard'))
    expect(res.status).toBe(401)
  })

  it('returns demo data for demo sessions', async () => {
    mockSession = { id: 'demo', isDemo: true }
    const res = await handler(makeRequest('/api/retention/scorecard'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.membersRetained).toBe(7)
    expect(body.revenueRetained).toBe(1050)
    expect(body.tasksCreated).toBeTypeOf('number')
  })

  it('returns real scorecard for authenticated gym owner', async () => {
    mockSession = { id: 'user-123' }
    fromResponses.team_members = { data: { accounts: { id: 'gym-abc' } }, error: null }

    const res = await handler(makeRequest('/api/retention/scorecard'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.membersRetained).toBe(5)
    expect(body.revenueRetained).toBe(750)
  })

  it('returns 400 when no gym connected', async () => {
    mockSession = { id: 'user-123' }
    // team_members defaults to null data — no account found

    const res = await handler(makeRequest('/api/retention/scorecard'))
    expect(res.status).toBe(400)
  })
})

// ── Activity Endpoint ────────────────────────────────────────────────────────

describe('GET /api/retention/activity', () => {
  let handler: typeof import('@/app/api/retention/activity/route').GET

  beforeEach(async () => {
    vi.resetModules()
    mockSession = null
    fromResponses = {}
    const mod = await import('@/app/api/retention/activity/route')
    handler = mod.GET
  })

  it('returns 401 when not authenticated', async () => {
    mockSession = null
    const res = await handler(makeRequest('/api/retention/activity'))
    expect(res.status).toBe(401)
  })

  it('returns demo activity for demo sessions', async () => {
    mockSession = { id: 'demo', isDemo: true }
    const res = await handler(makeRequest('/api/retention/activity'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('type')
    expect(body[0]).toHaveProperty('memberName')
  })

  it('returns 400 when no gym connected', async () => {
    mockSession = { id: 'user-123' }
    // team_members defaults to null data — no account found

    const res = await handler(makeRequest('/api/retention/activity'))
    expect(res.status).toBe(400)
  })
})

// ── Members Endpoint ─────────────────────────────────────────────────────────

describe('GET /api/retention/members', () => {
  let handler: typeof import('@/app/api/retention/members/route').GET

  beforeEach(async () => {
    vi.resetModules()
    mockSession = null
    fromResponses = {}
    const mod = await import('@/app/api/retention/members/route')
    handler = mod.GET
  })

  it('returns 401 when not authenticated', async () => {
    mockSession = null
    const res = await handler(makeRequest('/api/retention/members'))
    expect(res.status).toBe(401)
  })

  it('returns demo members for demo sessions', async () => {
    mockSession = { id: 'demo', isDemo: true }
    const res = await handler(makeRequest('/api/retention/members'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(5)
    // Abstract shape — priority/taskType/title instead of hardcoded riskLevel/lastCheckin
    expect(body[0]).toHaveProperty('priority')
    expect(body[0]).toHaveProperty('taskType')
    expect(body[0]).toHaveProperty('title')
    expect(body[0]).toHaveProperty('name')
  })

  it('returns 400 when no gym connected', async () => {
    mockSession = { id: 'user-123' }
    // team_members defaults to null data — no account found

    const res = await handler(makeRequest('/api/retention/members'))
    expect(res.status).toBe(400)
  })
})

// ── Autopilot Settings Endpoint ──────────────────────────────────────────────

describe('/api/settings/autopilot', () => {
  let getHandler: typeof import('@/app/api/settings/autopilot/route').GET
  let postHandler: typeof import('@/app/api/settings/autopilot/route').POST

  beforeEach(async () => {
    vi.resetModules()
    mockSession = null
    fromResponses = {}
    const mod = await import('@/app/api/settings/autopilot/route')
    getHandler = mod.GET
    postHandler = mod.POST
  })

  it('GET returns 401 when not authenticated', async () => {
    mockSession = null
    const res = await getHandler(makeRequest('/api/settings/autopilot'))
    expect(res.status).toBe(401)
  })

  it('GET returns autopilot status for demo sessions', async () => {
    mockSession = { id: 'demo', isDemo: true }
    const res = await getHandler(makeRequest('/api/settings/autopilot'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.autopilotEnabled).toBe(false)
  })

  it('POST returns 401 when not authenticated', async () => {
    mockSession = null
    const res = await postHandler(makeRequest('/api/settings/autopilot', {
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    }))
    expect(res.status).toBe(401)
  })

  it('POST returns 403 for demo sessions', async () => {
    mockSession = { id: 'demo', isDemo: true }
    const res = await postHandler(makeRequest('/api/settings/autopilot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }))
    expect(res.status).toBe(403)
  })
})
