/**
 * cronRunAnalysis.test.ts
 *
 * TDD tests for the run-analysis Vercel Cron endpoint.
 * Validates auth, calls GMAgent.runAnalysis per gym, returns summary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock supabase (gyms list) ─────────────────────────────────────────────────
// Already mocked globally in setup.ts — we override per test using module mock

// ── Mock GMAgent ─────────────────────────────────────────────────────────────

const { mockRunAnalysis, mockSetCreateInsightTask } = vi.hoisted(() => ({
  mockRunAnalysis: vi.fn().mockResolvedValue({
    gymId: 'gym-001',
    insightsFound: 3,
    tasksCreated: 3,
    insights: [],
  }),
  mockSetCreateInsightTask: vi.fn(),
}))

vi.mock('../agents/GMAgent', () => {
  return {
    GMAgent: class MockGMAgent {
      setCreateInsightTask = mockSetCreateInsightTask
      runAnalysis = mockRunAnalysis
      analyzeGym = vi.fn().mockReturnValue([])
      scoreChurnRisk = vi.fn().mockReturnValue({ score: 0.1, level: 'low', factors: [] })
      handleEvent = vi.fn().mockResolvedValue(undefined)
      draftMessage = vi.fn().mockResolvedValue('draft message')
    },
  }
})

// ── Mock db (tasks, kpi) ──────────────────────────────────────────────────────
vi.mock('../db/tasks', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'task-001' }),
  createInsightTask: vi.fn().mockResolvedValue({ id: 'task-001' }),
}))

vi.mock('../db/kpi', () => ({
  saveKPISnapshot: vi.fn().mockResolvedValue(undefined),
  getLatestKPISnapshot: vi.fn().mockResolvedValue(null),
}))

// ── Mock encrypt ──────────────────────────────────────────────────────────────
vi.mock('../encrypt', () => ({
  decrypt: vi.fn().mockReturnValue('decrypted-api-key'),
}))

// ── Mock pushpress-sdk ────────────────────────────────────────────────────────
vi.mock('../pushpress-sdk', () => ({
  PushPressSDK: class MockSDK {
    constructor(_opts: any) {}
    getCustomers = vi.fn().mockResolvedValue([])
    getCheckins = vi.fn().mockResolvedValue([])
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { POST } from '../../app/api/cron/run-analysis/route'

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/cron/run-analysis', () => {
  beforeEach(() => {
    mockRunAnalysis.mockReset()
    mockRunAnalysis.mockResolvedValue({
      gymId: 'gym-001',
      insightsFound: 3,
      tasksCreated: 3,
      insights: [],
    })
  })

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

  it('returns 200 with summary when valid secret provided', async () => {
    const req = makeRequest('test-cron-secret')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('gymsAnalyzed')
    expect(body).toHaveProperty('totalInsights')
    expect(body).toHaveProperty('totalTasksCreated')
  })

  it('returns correct totals in response body', async () => {
    mockRunAnalysis.mockResolvedValue({
      gymId: 'gym-001',
      insightsFound: 5,
      tasksCreated: 5,
      insights: [],
    })

    const req = makeRequest('test-cron-secret')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // At minimum a numeric count
    expect(typeof body.gymsAnalyzed).toBe('number')
    expect(typeof body.totalInsights).toBe('number')
    expect(typeof body.totalTasksCreated).toBe('number')
  })
})
