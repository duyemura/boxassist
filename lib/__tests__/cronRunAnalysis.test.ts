/**
 * cronRunAnalysis.test.ts
 *
 * TDD tests for the run-analysis Vercel Cron endpoint.
 * Validates auth, runs active agents per account via agent-runtime,
 * creates tasks, updates agent metadata, and returns a summary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockRunAgentAnalysis,
  mockCreateInsightTask,
  mockSaveKPISnapshot,
  mockAppendSystemEvent,
  mockCreateArtifact,
  mockBuildAccountSnapshot,
  mockDecrypt,
  mockGetMonthlyRetentionROI,
} = vi.hoisted(() => ({
  mockRunAgentAnalysis: vi.fn(),
  mockCreateInsightTask: vi.fn().mockResolvedValue({ id: 'task-001' }),
  mockSaveKPISnapshot: vi.fn().mockResolvedValue(undefined),
  mockAppendSystemEvent: vi.fn().mockResolvedValue(undefined),
  mockCreateArtifact: vi.fn().mockResolvedValue({ id: 'artifact-001' }),
  mockBuildAccountSnapshot: vi.fn(),
  mockDecrypt: vi.fn().mockReturnValue('decrypted-api-key'),
  mockGetMonthlyRetentionROI: vi.fn().mockResolvedValue({
    membersRetained: 0, revenueRetained: 0, messagesSent: 0,
    conversationsActive: 0, escalations: 0,
  }),
}))

// ── Mock agent-runtime ──────────────────────────────────────────────────────
vi.mock('../agents/agent-runtime', () => ({
  runAgentAnalysis: mockRunAgentAnalysis,
}))

// ── Mock db (tasks, kpi, chat) ──────────────────────────────────────────────
vi.mock('../db/tasks', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'task-001' }),
  createInsightTask: mockCreateInsightTask,
}))

vi.mock('../db/kpi', () => ({
  saveKPISnapshot: mockSaveKPISnapshot,
  getLatestKPISnapshot: vi.fn().mockResolvedValue(null),
  getMonthlyRetentionROI: mockGetMonthlyRetentionROI,
}))

vi.mock('../db/chat', () => ({
  appendSystemEvent: mockAppendSystemEvent,
  appendChatMessage: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock artifacts ──────────────────────────────────────────────────────────
vi.mock('../artifacts/db', () => ({
  createArtifact: mockCreateArtifact,
}))

vi.mock('../artifacts/render', () => ({
  renderArtifact: vi.fn().mockReturnValue('<html>test</html>'),
}))

// ── Mock encrypt ────────────────────────────────────────────────────────────
vi.mock('../encrypt', () => ({
  decrypt: mockDecrypt,
}))

// ── Mock pushpress-platform ─────────────────────────────────────────────────
vi.mock('../pushpress-platform', () => ({
  buildAccountSnapshot: mockBuildAccountSnapshot,
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
vi.mock('../models', () => ({
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
}))

// ── Supabase mock ───────────────────────────────────────────────────────────

// State variables that control what the supabase mock returns.
// Reset in beforeEach.
let mockAccounts: any[] = []
let mockAgentsForAccount: any[] = []
let mockRunCountForUpdate: number = 0

// Track calls to agents update for assertion
let agentUpdateCalls: any[] = []

function makeChain(resolvedData: any) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter',
  ]
  methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
  obj.then = (resolve: any) => resolve(resolvedData)
  return obj
}

function makeAgentChain() {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter',
  ]
  let isUpdate = false
  let isSingle = false

  methods.forEach(m => {
    obj[m] = vi.fn((...args: any[]) => {
      if (m === 'update') {
        isUpdate = true
        agentUpdateCalls.push(args)
      }
      if (m === 'single') isSingle = true
      return obj
    })
  })

  obj.then = (resolve: any) => {
    if (isUpdate) {
      return resolve({ data: null, error: null })
    }
    if (isSingle) {
      return resolve({ data: { run_count: mockRunCountForUpdate }, error: null })
    }
    // Default: agent list query
    return resolve({ data: mockAgentsForAccount, error: null })
  }
  return obj
}

/** Default supabase from() implementation. Re-applied in beforeEach. */
function defaultFromImpl(table: string) {
  if (table === 'accounts') {
    return makeChain({ data: mockAccounts, error: null })
  }
  if (table === 'agents') {
    return makeAgentChain()
  }
  return makeChain({ data: null, error: null })
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(defaultFromImpl),
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { POST } from '../../app/api/cron/run-analysis/route'
import { supabaseAdmin } from '@/lib/supabase'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (secret !== undefined) {
    headers['authorization'] = `Bearer ${secret}`
  }
  return new NextRequest('http://localhost/api/cron/run-analysis', {
    method: 'POST',
    headers,
  })
}

function makeInsight(overrides?: Record<string, any>) {
  return {
    type: 'churn_risk',
    priority: 'high',
    memberId: 'm1',
    memberName: 'Sarah Johnson',
    memberEmail: 'sarah@example.com',
    title: "Sarah hasn't visited in 18 days",
    detail: 'Attendance dropped significantly.',
    recommendedAction: 'Send a check-in message',
    estimatedImpact: '$150/mo at risk',
    ...overrides,
  }
}

const DEFAULT_SNAPSHOT = {
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
  ],
  recentCheckins: [],
  recentLeads: [],
  paymentEvents: [],
  capturedAt: '2026-02-26T08:00:00Z',
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/cron/run-analysis', () => {
  beforeEach(() => {
    // Reset hoisted mocks
    mockRunAgentAnalysis.mockReset()
    mockCreateInsightTask.mockReset().mockResolvedValue({ id: 'task-001' })
    mockSaveKPISnapshot.mockReset().mockResolvedValue(undefined)
    mockAppendSystemEvent.mockReset().mockResolvedValue(undefined)
    mockCreateArtifact.mockReset().mockResolvedValue({ id: 'artifact-001' })
    mockBuildAccountSnapshot.mockReset()
    mockDecrypt.mockReset().mockReturnValue('decrypted-api-key')
    mockGetMonthlyRetentionROI.mockReset().mockResolvedValue({
      membersRetained: 0, revenueRetained: 0, messagesSent: 0,
      conversationsActive: 0, escalations: 0,
    })

    // Reset state
    agentUpdateCalls = []

    // Restore default supabase behavior (important: previous tests may override)
    vi.mocked(supabaseAdmin.from).mockImplementation(defaultFromImpl)

    // Defaults: one account with one active agent, one insight returned
    mockAccounts = [
      {
        id: 'acct-001',
        gym_name: 'Test Gym',
        pushpress_api_key: 'encrypted-key',
        pushpress_company_id: 'company-001',
        avg_membership_price: 150,
      },
    ]

    mockAgentsForAccount = [
      {
        id: 'agent-001',
        skill_type: 'at_risk_detector',
        system_prompt: null,
        name: 'Churn Detector',
      },
    ]

    mockRunCountForUpdate = 3

    mockBuildAccountSnapshot.mockResolvedValue(DEFAULT_SNAPSHOT)

    mockRunAgentAnalysis.mockResolvedValue({
      insights: [makeInsight()],
    })
  })

  // ── Auth tests ──────────────────────────────────────────────────────────────

  it('returns 401 when no authorization header provided', async () => {
    const req = makeRequest(undefined)
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret provided', async () => {
    const req = makeRequest('wrong-secret')
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns 200 with summary when valid secret + has active agents', async () => {
    const req = makeRequest('test-cron-secret')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('accountsAnalyzed')
    expect(body).toHaveProperty('totalInsights')
    expect(body).toHaveProperty('totalTasksCreated')
    expect(body.ok).toBe(true)
  })

  it('returns correct totals — runAgentAnalysis called once per active agent', async () => {
    // Two agents for the account
    mockAgentsForAccount = [
      { id: 'agent-001', skill_type: 'at_risk_detector', system_prompt: null, name: 'Churn Detector' },
      { id: 'agent-002', skill_type: 'lead_nurture', system_prompt: 'Be friendly.', name: 'Lead Nurturer' },
    ]

    mockRunAgentAnalysis
      .mockResolvedValueOnce({ insights: [makeInsight(), makeInsight({ memberId: 'm2', memberName: 'Mike Torres' })] })
      .mockResolvedValueOnce({ insights: [makeInsight({ memberId: 'm3', memberName: 'Emma Walsh', type: 'lead_nurture' })] })

    const req = makeRequest('test-cron-secret')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.accountsAnalyzed).toBe(1)
    expect(body.totalInsights).toBe(3)
    expect(body.totalTasksCreated).toBe(3)

    // runAgentAnalysis called once per agent
    expect(mockRunAgentAnalysis).toHaveBeenCalledTimes(2)

    // Verify skill types passed through
    const firstCall = mockRunAgentAnalysis.mock.calls[0][0]
    expect(firstCall.skillType).toBe('at_risk_detector')
    expect(firstCall.accountId).toBe('acct-001')

    const secondCall = mockRunAgentAnalysis.mock.calls[1][0]
    expect(secondCall.skillType).toBe('lead_nurture')
    expect(secondCall.systemPromptOverride).toBe('Be friendly.')

    // createInsightTask called once per insight
    expect(mockCreateInsightTask).toHaveBeenCalledTimes(3)
  })

  // ── Skip logic ────────────────────────────────────────────────────────────

  it('skips accounts with no active agents', async () => {
    // Two accounts
    mockAccounts = [
      {
        id: 'acct-001',
        gym_name: 'Active Gym',
        pushpress_api_key: 'encrypted-key',
        pushpress_company_id: 'company-001',
        avg_membership_price: 150,
      },
      {
        id: 'acct-002',
        gym_name: 'Empty Gym',
        pushpress_api_key: 'encrypted-key-2',
        pushpress_company_id: 'company-002',
        avg_membership_price: 100,
      },
    ]

    // Use a counter to alternate autopilot list query results per account
    let agentListCallCount = 0

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'accounts') {
        return makeChain({ data: mockAccounts, error: null }) as any
      }
      if (table === 'agents') {
        const obj: any = {}
        const methods = [
          'select', 'insert', 'update', 'delete', 'upsert',
          'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
          'single', 'maybeSingle', 'limit', 'order', 'filter',
        ]
        let isUpdate = false
        let isSingle = false

        methods.forEach(m => {
          obj[m] = vi.fn((...args: any[]) => {
            if (m === 'update') {
              isUpdate = true
              agentUpdateCalls.push(args)
            }
            if (m === 'single') isSingle = true
            return obj
          })
        })

        obj.then = (resolve: any) => {
          if (isUpdate) return resolve({ data: null, error: null })
          if (isSingle) return resolve({ data: { run_count: 3 }, error: null })
          // List query — alternate between accounts
          agentListCallCount++
          if (agentListCallCount === 1) {
            return resolve({ data: mockAgentsForAccount, error: null })
          }
          return resolve({ data: [], error: null })
        }
        return obj
      }
      return makeChain({ data: null, error: null }) as any
    })

    const req = makeRequest('test-cron-secret')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Only the first account has agents, so only 1 is analyzed
    expect(body.accountsAnalyzed).toBe(1)
    // runAgentAnalysis only called for the first account's agent
    expect(mockRunAgentAnalysis).toHaveBeenCalledTimes(1)
  })

  // ── Metadata updates ──────────────────────────────────────────────────────

  it('updates last_run_at and run_count per agent after run', async () => {
    const req = makeRequest('test-cron-secret')
    await POST(req)

    // Verify the update was called with the correct run_count increment.
    expect(agentUpdateCalls.length).toBe(1)

    // The update arg should contain last_run_at and run_count: 4 (3 + 1)
    const updateArg = agentUpdateCalls[0][0]
    expect(updateArg).toHaveProperty('last_run_at')
    expect(updateArg.run_count).toBe(4) // mockRunCountForUpdate (3) + 1
  })

  // ── KPI + system event ────────────────────────────────────────────────────

  it('saves KPI snapshot and system event after processing agents', async () => {
    const req = makeRequest('test-cron-secret')
    await POST(req)

    expect(mockSaveKPISnapshot).toHaveBeenCalledTimes(1)
    expect(mockSaveKPISnapshot).toHaveBeenCalledWith('acct-001', expect.objectContaining({
      activeMembers: 1,
      insightsGenerated: 1,
    }))

    expect(mockAppendSystemEvent).toHaveBeenCalledTimes(1)
    expect(mockAppendSystemEvent).toHaveBeenCalledWith(
      'acct-001',
      expect.stringContaining('1 insight'),
    )
  })

  it('creates artifact when insights are found', async () => {
    const req = makeRequest('test-cron-secret')
    await POST(req)

    // Artifact generation is fire-and-forget, wait a tick for .catch() to settle
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mockCreateArtifact).toHaveBeenCalledTimes(1)
    expect(mockCreateArtifact).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acct-001',
      artifactType: 'research_summary',
      shareable: true,
    }))
  })

  it('passes snapshot through to runAgentAnalysis', async () => {
    const req = makeRequest('test-cron-secret')
    await POST(req)

    expect(mockBuildAccountSnapshot).toHaveBeenCalledWith(
      'acct-001',
      'Test Gym',
      'decrypted-api-key',
      'company-001',
      150,
    )

    expect(mockRunAgentAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        skillType: 'at_risk_detector',
        accountId: 'acct-001',
      }),
      DEFAULT_SNAPSHOT,
      expect.objectContaining({ evaluate: expect.any(Function) }),
    )
  })
})
