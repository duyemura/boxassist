/**
 * cronRunAnalysis.test.ts
 *
 * TDD tests for the run-analysis Vercel Cron endpoint.
 * Validates auth, queries agent_automations for due agents,
 * runs them via agent-runtime, creates tasks, and records runs.
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

let mockAccounts: any[] = []
let mockAutomationsForAccount: any[] = []
let agentRunInserts: any[] = []

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

function makeRunsChain() {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'is', 'or', 'not', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter',
  ]
  methods.forEach(m => {
    obj[m] = vi.fn((...args: any[]) => {
      if (m === 'insert') agentRunInserts.push(args[0])
      return obj
    })
  })
  obj.then = (resolve: any) => resolve({ data: null, error: null })
  return obj
}

function defaultFromImpl(table: string) {
  if (table === 'accounts') return makeChain({ data: mockAccounts, error: null })
  if (table === 'agent_automations') return makeChain({ data: mockAutomationsForAccount, error: null })
  if (table === 'agent_runs') return makeRunsChain()
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== undefined) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost/api/cron/run-analysis', { method: 'POST', headers })
}

function makeInsight(overrides?: Record<string, any>) {
  return {
    type: 'churn_risk', priority: 'high', memberId: 'm1',
    memberName: 'Sarah Johnson', memberEmail: 'sarah@example.com',
    title: "Sarah hasn't visited in 18 days", detail: 'Attendance dropped significantly.',
    recommendedAction: 'Send a check-in message', estimatedImpact: '$150/mo at risk',
    ...overrides,
  }
}

const DEFAULT_SNAPSHOT = {
  accountId: 'acct-001', accountName: 'Test Gym',
  members: [{
    id: 'm1', name: 'Sarah Johnson', email: 'sarah@example.com',
    status: 'active', membershipType: 'Unlimited',
    memberSince: '2025-06-01', lastCheckinAt: '2026-02-08',
    recentCheckinsCount: 2, previousCheckinsCount: 12, monthlyRevenue: 150,
  }],
  recentCheckins: [], recentLeads: [], paymentEvents: [],
  capturedAt: '2026-02-26T08:00:00Z',
}

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/cron/run-analysis', () => {
  beforeEach(() => {
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
    agentRunInserts = []

    vi.mocked(supabaseAdmin.from).mockImplementation(defaultFromImpl)

    mockAccounts = [{
      id: 'acct-001', gym_name: 'Test Gym',
      pushpress_api_key: 'encrypted-key',
      pushpress_company_id: 'company-001',
      avg_membership_price: 150,
    }]

    // Automations join agents — the cron route queries agent_automations
    mockAutomationsForAccount = [{
      id: 'auto-001', cron_schedule: 'hourly', run_hour: 9, agent_id: 'agent-001',
      agents: { id: 'agent-001', skill_type: 'at_risk_detector', system_prompt: null, name: 'Churn Detector' },
    }]

    mockBuildAccountSnapshot.mockResolvedValue(DEFAULT_SNAPSHOT)
    mockRunAgentAnalysis.mockResolvedValue({ insights: [makeInsight()] })
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 401 when no authorization header provided', async () => {
    const res = await POST(makeRequest(undefined))
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret provided', async () => {
    const res = await POST(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 200 with summary when valid secret + has active automations', async () => {
    const res = await POST(makeRequest('test-cron-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, accountsAnalyzed: 1, totalInsights: 1 })
  })

  it('runs each agent from due automations', async () => {
    mockAutomationsForAccount = [
      { id: 'auto-001', cron_schedule: 'hourly', run_hour: 9, agent_id: 'agent-001', agents: { id: 'agent-001', skill_type: 'at_risk_detector', system_prompt: null, name: 'Churn Detector' } },
      { id: 'auto-002', cron_schedule: 'hourly', run_hour: 9, agent_id: 'agent-002', agents: { id: 'agent-002', skill_type: 'lead_nurture', system_prompt: 'Be friendly.', name: 'Lead Nurturer' } },
    ]

    mockRunAgentAnalysis
      .mockResolvedValueOnce({ insights: [makeInsight(), makeInsight({ memberId: 'm2' })] })
      .mockResolvedValueOnce({ insights: [makeInsight({ memberId: 'm3', type: 'lead_nurture' })] })

    const res = await POST(makeRequest('test-cron-secret'))
    const body = await res.json()

    expect(body.totalInsights).toBe(3)
    expect(body.totalTasksCreated).toBe(3)
    expect(mockRunAgentAnalysis).toHaveBeenCalledTimes(2)
    expect(mockRunAgentAnalysis.mock.calls[0][0].skillType).toBe('at_risk_detector')
    expect(mockRunAgentAnalysis.mock.calls[1][0].skillType).toBe('lead_nurture')
    expect(mockCreateInsightTask).toHaveBeenCalledTimes(3)
  })

  // ── Skip logic ──────────────────────────────────────────────────────────────

  it('skips accounts with no due automations', async () => {
    mockAccounts = [
      { id: 'acct-001', gym_name: 'Active Gym', pushpress_api_key: 'k1', pushpress_company_id: 'c1', avg_membership_price: 150 },
      { id: 'acct-002', gym_name: 'Empty Gym', pushpress_api_key: 'k2', pushpress_company_id: 'c2', avg_membership_price: 100 },
    ]

    let autoCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'accounts') return makeChain({ data: mockAccounts, error: null }) as any
      if (table === 'agent_automations') {
        autoCallCount++
        return makeChain({ data: autoCallCount === 1 ? mockAutomationsForAccount : [], error: null }) as any
      }
      if (table === 'agent_runs') return makeRunsChain() as any
      return makeChain({ data: null, error: null }) as any
    })

    const body = await (await POST(makeRequest('test-cron-secret'))).json()
    expect(body.accountsAnalyzed).toBe(1)
    expect(mockRunAgentAnalysis).toHaveBeenCalledTimes(1)
  })

  // ── Run records ─────────────────────────────────────────────────────────────

  it('inserts agent_runs with agent_id and trigger_source=cron', async () => {
    await POST(makeRequest('test-cron-secret'))

    expect(agentRunInserts.length).toBeGreaterThanOrEqual(1)
    const runInsert = agentRunInserts[0]
    expect(runInsert).toMatchObject({
      account_id: 'acct-001',
      agent_id: 'agent-001',
      trigger_source: 'cron',
      status: 'completed',
    })
  })

  // ── KPI + system event ──────────────────────────────────────────────────────

  it('saves KPI snapshot and system event after processing agents', async () => {
    await POST(makeRequest('test-cron-secret'))

    expect(mockSaveKPISnapshot).toHaveBeenCalledWith('acct-001', expect.objectContaining({
      activeMembers: 1, insightsGenerated: 1,
    }))
    expect(mockAppendSystemEvent).toHaveBeenCalledWith('acct-001', expect.stringContaining('1 insight'))
  })

  it('creates artifact when insights are found', async () => {
    await POST(makeRequest('test-cron-secret'))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mockCreateArtifact).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acct-001', artifactType: 'research_summary', shareable: true,
    }))
  })

  it('passes snapshot through to runAgentAnalysis', async () => {
    await POST(makeRequest('test-cron-secret'))

    expect(mockBuildAccountSnapshot).toHaveBeenCalledWith('acct-001', 'Test Gym', 'decrypted-api-key', 'company-001', 150)
    expect(mockRunAgentAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ skillType: 'at_risk_detector', accountId: 'acct-001' }),
      DEFAULT_SNAPSHOT,
      expect.objectContaining({ evaluate: expect.any(Function) }),
    )
  })
})
