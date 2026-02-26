/**
 * autopilotRun.test.ts
 *
 * Tests for POST /api/agents/run — SSE endpoint.
 * Validates:
 *   - 401 when not authenticated
 *   - SSE error when no account connected
 *   - SSE error when no active agents configured
 *   - SSE done event on successful real-account run (multi-agent)
 *   - SSE done event on demo path
 *   - Free tier run limit enforcement
 *   - Correct SSE headers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockSessionRef,
  mockAccountRef,
  mockUserRef,
  mockCreateInsightTask,
  mockGetAtRiskMembers,
  mockRunAtRiskDetector,
  mockRunAgentAnalysis,
  mockBuildAccountSnapshot,
  mockDecrypt,
} = vi.hoisted(() => ({
  mockSessionRef: { current: null as any },
  mockAccountRef: { current: null as any },
  mockUserRef: { current: null as any },
  mockCreateInsightTask: vi.fn().mockResolvedValue({ id: 'task-001' }),
  mockGetAtRiskMembers: vi.fn().mockResolvedValue([]),
  mockRunAtRiskDetector: vi.fn().mockResolvedValue({
    totalAtRisk: 2,
    actions: [
      {
        memberId: 'm1', memberName: 'Sarah Johnson', memberEmail: 'sarah@example.com',
        riskLevel: 'high', riskReason: 'No visits in 18 days',
        recommendedAction: 'Send check-in', draftedMessage: 'Hey Sarah...',
        messageSubject: 'We miss you!', confidence: 0.85,
        insights: 'Attendance dropped', playbookName: 'at_risk_detector',
        estimatedImpact: '$150/mo',
      },
    ],
    _usage: { input_tokens: 500, output_tokens: 200 },
  }),
  mockRunAgentAnalysis: vi.fn().mockResolvedValue({
    insights: [
      {
        type: 'churn_risk', priority: 'high', memberId: 'm1',
        memberName: 'Sarah Johnson', memberEmail: 'sarah@example.com',
        title: "Sarah hasn't visited in 18 days",
        detail: 'Attendance dropped significantly.',
        recommendedAction: 'Send a check-in message',
        estimatedImpact: '$150/mo at risk',
      },
    ],
  }),
  mockBuildAccountSnapshot: vi.fn().mockResolvedValue({
    accountId: 'acct-001', accountName: 'Test Gym',
    members: [
      {
        id: 'm1', name: 'Sarah Johnson', email: 'sarah@example.com',
        status: 'active', membershipType: 'Unlimited',
        memberSince: '2025-06-01', lastCheckinAt: '2026-02-08',
        recentCheckinsCount: 2, previousCheckinsCount: 12,
        monthlyRevenue: 150,
      },
    ],
    recentCheckins: [], recentLeads: [], paymentEvents: [],
    capturedAt: '2026-02-26T08:00:00Z',
  }),
  mockDecrypt: vi.fn().mockReturnValue('decrypted-api-key'),
}))

// ── Mock auth ───────────────────────────────────────────────────────────────
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockSessionRef.current),
  getTier: vi.fn((user: any) => user?.tier ?? 'starter'),
}))

// ── Mock db/accounts ────────────────────────────────────────────────────────
vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: vi.fn(() => mockAccountRef.current),
}))

// ── Mock pushpress client ───────────────────────────────────────────────────
vi.mock('@/lib/pushpress', () => ({
  createPushPressClient: vi.fn(() => ({
    apiKey: 'test-key', companyId: 'test-company', fetch: vi.fn(),
  })),
  getAtRiskMembers: mockGetAtRiskMembers,
}))

// ── Mock pushpress-platform ─────────────────────────────────────────────────
vi.mock('@/lib/pushpress-platform', () => ({
  buildAccountSnapshot: mockBuildAccountSnapshot,
}))

// ── Mock agent-runtime ──────────────────────────────────────────────────────
vi.mock('@/lib/agents/agent-runtime', () => ({
  runAgentAnalysis: mockRunAgentAnalysis,
}))

// ── Mock claude ─────────────────────────────────────────────────────────────
vi.mock('@/lib/claude', () => ({
  runAtRiskDetector: mockRunAtRiskDetector,
}))

// ── Mock encrypt ────────────────────────────────────────────────────────────
vi.mock('@/lib/encrypt', () => ({
  decrypt: mockDecrypt,
}))

// ── Mock cost ───────────────────────────────────────────────────────────────
vi.mock('@/lib/cost', () => ({
  calcCost: vi.fn().mockReturnValue({ costUsd: 0.01, markupUsd: 0.003, billedUsd: 0.013 }),
  calcTimeSaved: vi.fn().mockReturnValue(5),
}))

// ── Mock tasks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/db/tasks', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'task-001' }),
  createInsightTask: mockCreateInsightTask,
}))

// ── Mock Anthropic ──────────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{ "insights": [] }' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  })
  class MockAnthropic {
    messages = { create: mockCreate }
    constructor(_opts?: any) {}
  }
  return { default: MockAnthropic }
})

// ── Mock models ─────────────────────────────────────────────────────────────
vi.mock('@/lib/models', () => ({
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
}))

// ── Supabase mock ───────────────────────────────────────────────────────────

let mockAgentsForAccount: any[] = []
let mockAgentRunsCount = 0

function makeChain(resolvedData: any) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter', 'gt',
  ]
  methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
  obj.then = (resolve: any) => resolve(resolvedData)
  return obj
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return makeChain({ data: mockUserRef.current, error: null })
      }
      if (table === 'agent_runs') {
        const obj: any = {}
        const methods = [
          'select', 'insert', 'update', 'delete', 'upsert',
          'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
          'single', 'maybeSingle', 'limit', 'order', 'filter',
        ]
        let isInsert = false

        methods.forEach(m => {
          obj[m] = vi.fn((..._args: any[]) => {
            if (m === 'insert') isInsert = true
            return obj
          })
        })

        obj.then = (resolve: any) => {
          if (isInsert) {
            return resolve({ data: { id: 'run-001' }, error: null })
          }
          // count query for free tier limit
          return resolve({ data: null, error: null, count: mockAgentRunsCount })
        }
        return obj
      }
      if (table === 'agents') {
        const obj: any = {}
        const methods = [
          'select', 'insert', 'update', 'delete', 'upsert',
          'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
          'single', 'maybeSingle', 'limit', 'order', 'filter', 'gt',
        ]
        let isUpdate = false

        methods.forEach(m => {
          obj[m] = vi.fn((..._args: any[]) => {
            if (m === 'update') isUpdate = true
            return obj
          })
        })

        obj.then = (resolve: any) => {
          if (isUpdate) return resolve({ data: null, error: null })
          // List or single query — return agents list
          return resolve({ data: mockAgentsForAccount, error: null })
        }
        return obj
      }
      return makeChain({ data: null, error: null })
    }),
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { POST } from '../../app/api/agents/run/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/agents/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Read all SSE events from a ReadableStream response.
 * Returns an array of parsed SSE event objects.
 */
async function readSSEEvents(response: Response): Promise<any[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const events: any[] = []
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Parse SSE lines
    const lines = buffer.split('\n\n')
    buffer = lines.pop() ?? '' // keep incomplete chunk in buffer

    for (const line of lines) {
      const match = line.match(/^data: (.+)$/)
      if (match) {
        try {
          events.push(JSON.parse(match[1]))
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  return events
}

const DEFAULT_ACCOUNT = {
  id: 'acct-001',
  gym_name: 'Test Gym',
  account_name: 'Test Gym',
  pushpress_api_key: 'encrypted-key',
  pushpress_company_id: 'company-001',
  avg_membership_price: 150,
  member_count: 50,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/agents/run (SSE)', () => {
  beforeEach(() => {
    mockRunAgentAnalysis.mockReset().mockResolvedValue({
      insights: [
        {
          type: 'churn_risk', priority: 'high', memberId: 'm1',
          memberName: 'Sarah Johnson', memberEmail: 'sarah@example.com',
          title: "Sarah hasn't visited in 18 days",
          detail: 'Attendance dropped significantly.',
          recommendedAction: 'Send a check-in message',
          estimatedImpact: '$150/mo at risk',
        },
      ],
    })
    mockCreateInsightTask.mockReset().mockResolvedValue({ id: 'task-001' })
    mockBuildAccountSnapshot.mockReset().mockResolvedValue({
      accountId: 'acct-001', accountName: 'Test Gym',
      members: [
        {
          id: 'm1', name: 'Sarah Johnson', email: 'sarah@example.com',
          status: 'active', membershipType: 'Unlimited',
          memberSince: '2025-06-01', lastCheckinAt: '2026-02-08',
          recentCheckinsCount: 2, previousCheckinsCount: 12,
          monthlyRevenue: 150,
        },
      ],
      recentCheckins: [], recentLeads: [], paymentEvents: [],
      capturedAt: '2026-02-26T08:00:00Z',
    })
    mockDecrypt.mockReset().mockReturnValue('decrypted-api-key')
    mockRunAtRiskDetector.mockReset().mockResolvedValue({
      totalAtRisk: 1,
      actions: [
        {
          memberId: 'm1', memberName: 'Sarah Johnson', memberEmail: 'sarah@example.com',
          riskLevel: 'high', riskReason: 'No visits', recommendedAction: 'Reach out',
          draftedMessage: 'Hey!', messageSubject: 'Hi', confidence: 0.85,
          insights: 'dropped', playbookName: 'at_risk_detector', estimatedImpact: '$150',
        },
      ],
      _usage: { input_tokens: 500, output_tokens: 200 },
    })
    mockGetAtRiskMembers.mockReset().mockResolvedValue([])

    mockSessionRef.current = null
    mockAccountRef.current = null
    mockUserRef.current = { id: 'user-001', email: 'owner@gym.com', tier: 'starter' }
    mockAgentsForAccount = [
      { id: 'agent-001', skill_type: 'at_risk_detector', system_prompt: null, name: 'Churn Detector', run_count: 5 },
    ]
    mockAgentRunsCount = 0
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockSessionRef.current = null

    const res = await POST(makeRequest())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  // ── No account ────────────────────────────────────────────────────────────

  it('emits SSE error when no account connected', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockAccountRef.current = null

    const res = await POST(makeRequest())

    expect(res.status).toBe(200) // SSE always returns 200
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const events = await readSSEEvents(res)

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent.message).toContain('No gym connected')
  })

  // ── No active agents ──────────────────────────────────────────────────────

  it('emits SSE error when no active agents configured', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockAgentsForAccount = [] // no agents

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const events = await readSSEEvents(res)

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent.message).toContain('No active agents')
  })

  // ── Happy path (real account, multi-agent) ────────────────────────────────

  it('emits SSE status + done events on successful multi-agent run', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const events = await readSSEEvents(res)

    const statusEvents = events.filter(e => e.type === 'status')
    const doneEvent = events.find(e => e.type === 'done')

    // Should have status events: checking creds, fetching data, fetching agents,
    // running agent, agent results, analysis complete
    expect(statusEvents.length).toBeGreaterThanOrEqual(3)
    expect(doneEvent).toBeTruthy()
    expect(doneEvent.result.success).toBe(true)
    expect(doneEvent.result.runId).toBe('run-001')
    expect(doneEvent.result.output).toBeTruthy()
    expect(doneEvent.result.output.agentResults).toHaveLength(1)
  })

  it('creates tasks via createInsightTask for each insight', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT

    const res = await POST(makeRequest())
    await readSSEEvents(res) // drain the stream

    expect(mockCreateInsightTask).toHaveBeenCalledTimes(1)
    expect(mockCreateInsightTask).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acct-001',
      insight: expect.objectContaining({
        memberName: 'Sarah Johnson',
        type: 'churn_risk',
      }),
    }))
  })

  it('calls runAgentAnalysis for each active agent', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockAgentsForAccount = [
      { id: 'agent-001', skill_type: 'at_risk_detector', system_prompt: null, name: 'Churn Detector', run_count: 5 },
      { id: 'agent-002', skill_type: 'lead_nurture', system_prompt: 'Be friendly.', name: 'Lead Bot', run_count: 2 },
    ]

    mockRunAgentAnalysis
      .mockResolvedValueOnce({ insights: [{ type: 'churn_risk', priority: 'high', memberId: 'm1', memberName: 'A', memberEmail: 'a@b.c', title: 'T', detail: 'D', recommendedAction: 'R', estimatedImpact: 'E' }] })
      .mockResolvedValueOnce({ insights: [] })

    const res = await POST(makeRequest())
    await readSSEEvents(res)

    expect(mockRunAgentAnalysis).toHaveBeenCalledTimes(2)
    expect(mockRunAgentAnalysis.mock.calls[0][0].skillType).toBe('at_risk_detector')
    expect(mockRunAgentAnalysis.mock.calls[1][0].skillType).toBe('lead_nurture')
    expect(mockRunAgentAnalysis.mock.calls[1][0].systemPromptOverride).toBe('Be friendly.')
  })

  // ── Demo path ─────────────────────────────────────────────────────────────

  it('handles demo session with SSE done event', async () => {
    mockSessionRef.current = {
      id: 'demo-user', email: 'demo@example.com',
      isDemo: true, demoSessionId: 'demo-session-001',
    }

    // Demo path uses PUSHPRESS_API_KEY env var
    process.env.PUSHPRESS_API_KEY = 'demo-api-key'
    process.env.PUSHPRESS_COMPANY_ID = 'demo-company'

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const events = await readSSEEvents(res)

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeTruthy()
    expect(doneEvent.result.success).toBe(true)
    expect(doneEvent.result.isDemo).toBe(true)

    // Clean up
    delete process.env.PUSHPRESS_API_KEY
    delete process.env.PUSHPRESS_COMPANY_ID
  })

  // ── Free tier limit ───────────────────────────────────────────────────────

  it('emits SSE error when free tier monthly limit reached', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockUserRef.current = { id: 'user-001', email: 'owner@gym.com', tier: 'free' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockAgentRunsCount = 5 // over the limit of 3

    // Override getTier to return 'free'
    const { getTier } = await import('@/lib/auth')
    vi.mocked(getTier).mockReturnValueOnce('free')

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const events = await readSSEEvents(res)

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent.message).toContain('limit')
  })

  // ── SSE headers ───────────────────────────────────────────────────────────

  it('returns correct SSE headers', async () => {
    mockSessionRef.current = { id: 'user-001', email: 'owner@gym.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT

    const res = await POST(makeRequest())
    await readSSEEvents(res) // drain the stream

    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(res.headers.get('Connection')).toBe('keep-alive')
  })
})
