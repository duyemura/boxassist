/**
 * feedback.test.ts
 *
 * Tests for the /api/feedback API route (POST, GET) and the
 * client-side error buffer (lib/feedback-errors.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockSessionRef, mockInsertChain, mockSelectChain } = vi.hoisted(() => ({
  mockSessionRef: { current: null as any },
  mockInsertChain: {
    select: vi.fn(),
    single: vi.fn(),
  },
  mockSelectChain: {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  },
}))

// ── Mock auth ───────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockSessionRef.current),
}))

// ── Mock supabase ──────────────────────────────────────────────────────────

const mockFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (...args: any[]) => mockFrom(...args) },
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(method: string, body?: any, url?: string): NextRequest {
  const reqUrl = url || 'http://localhost:3000/api/feedback'
  if (method === 'GET') {
    return new NextRequest(reqUrl, { method })
  }
  return new NextRequest(reqUrl, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function setupInsertMock(result: { data: any; error: any }) {
  const singleFn = vi.fn().mockResolvedValue(result)
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  mockFrom.mockReturnValue({ insert: insertFn })
  return { insertFn, selectFn, singleFn }
}

function setupSelectMock(result: { data: any; error: any }) {
  const limitFn = vi.fn().mockResolvedValue(result)
  const orderFn = vi.fn().mockReturnValue({ limit: limitFn })
  const eqFn = vi.fn().mockReturnValue({ order: orderFn })
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
  mockFrom.mockReturnValue({ select: selectFn })
  return { selectFn, eqFn, orderFn, limitFn }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/feedback', () => {
  let POST: any

  beforeEach(async () => {
    vi.resetModules()
    mockSessionRef.current = null
    mockFrom.mockReset()
    const mod = await import('@/app/api/feedback/route')
    POST = mod.POST
  })

  it('rejects when message is missing', async () => {
    const res = await POST(makeRequest('POST', { type: 'bug' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/message is required/)
  })

  it('rejects when message is empty string', async () => {
    const res = await POST(makeRequest('POST', { message: '   ' }))
    expect(res.status).toBe(400)
  })

  it('rejects invalid type', async () => {
    const res = await POST(makeRequest('POST', { type: 'invalid', message: 'hello' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/type must be one of/)
  })

  it('inserts feedback successfully without auth', async () => {
    setupInsertMock({ data: { id: 'fb-001' }, error: null })

    const res = await POST(makeRequest('POST', {
      type: 'bug',
      message: 'Something broke',
      url: 'http://localhost:3000/dashboard',
    }))

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.id).toBe('fb-001')
  })

  it('inserts feedback with authenticated user', async () => {
    mockSessionRef.current = { id: 'user-123', accountId: 'acc-456' }
    const { insertFn } = setupInsertMock({ data: { id: 'fb-002' }, error: null })

    const res = await POST(makeRequest('POST', {
      message: 'Love the new feature',
      type: 'feedback',
    }))

    expect(res.status).toBe(201)
    // Verify user_id and account_id were passed
    const insertArg = insertFn.mock.calls[0][0]
    expect(insertArg.user_id).toBe('user-123')
    expect(insertArg.account_id).toBe('acc-456')
  })

  it('defaults type to feedback when not provided', async () => {
    const { insertFn } = setupInsertMock({ data: { id: 'fb-003' }, error: null })

    await POST(makeRequest('POST', { message: 'General feedback' }))
    expect(insertFn.mock.calls[0][0].type).toBe('feedback')
  })

  it('truncates long messages', async () => {
    const { insertFn } = setupInsertMock({ data: { id: 'fb-004' }, error: null })
    const longMessage = 'x'.repeat(6000)

    await POST(makeRequest('POST', { message: longMessage }))
    expect(insertFn.mock.calls[0][0].message.length).toBeLessThanOrEqual(5000)
  })

  it('handles DB insert error gracefully', async () => {
    setupInsertMock({ data: null, error: { message: 'DB error' } })

    const res = await POST(makeRequest('POST', { message: 'test' }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/Failed to save/)
  })
})

describe('GET /api/feedback', () => {
  let GET: any

  beforeEach(async () => {
    vi.resetModules()
    mockSessionRef.current = null
    mockFrom.mockReset()
    const mod = await import('@/app/api/feedback/route')
    GET = mod.GET
  })

  it('requires auth', async () => {
    mockSessionRef.current = null
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(401)
  })

  it('returns feedback when authenticated', async () => {
    mockSessionRef.current = { id: 'user-1' }
    setupSelectMock({
      data: [
        { id: 'fb-1', type: 'bug', message: 'broken', status: 'new', created_at: '2026-01-01' },
      ],
      error: null,
    })

    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.feedback).toHaveLength(1)
    expect(json.feedback[0].id).toBe('fb-1')
  })

  it('respects status and limit params', async () => {
    mockSessionRef.current = { id: 'user-1' }
    const { eqFn, limitFn } = setupSelectMock({ data: [], error: null })

    await GET(makeRequest('GET', null, 'http://localhost:3000/api/feedback?status=seen&limit=5'))

    expect(eqFn).toHaveBeenCalledWith('status', 'seen')
    expect(limitFn).toHaveBeenCalledWith(5)
  })

  it('caps limit at 100', async () => {
    mockSessionRef.current = { id: 'user-1' }
    const { limitFn } = setupSelectMock({ data: [], error: null })

    await GET(makeRequest('GET', null, 'http://localhost:3000/api/feedback?limit=500'))

    expect(limitFn).toHaveBeenCalledWith(100)
  })
})

// ── Client-side error buffer tests ─────────────────────────────────────────

describe('feedback-errors buffer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('recentErrors starts empty', async () => {
    const { recentErrors } = await import('@/lib/feedback-errors')
    expect(recentErrors).toEqual([])
  })

  it('getRecentErrorSummary returns undefined when no errors', async () => {
    const { getRecentErrorSummary } = await import('@/lib/feedback-errors')
    expect(getRecentErrorSummary()).toBeUndefined()
  })

  it('getRecentErrorSummary formats buffered errors', async () => {
    const { recentErrors, getRecentErrorSummary } = await import('@/lib/feedback-errors')
    recentErrors.push(
      { message: 'Error 1', timestamp: new Date('2026-01-01T10:00:00Z').getTime() },
      { message: 'Error 2', timestamp: new Date('2026-01-01T10:01:00Z').getTime() },
    )
    const summary = getRecentErrorSummary()
    expect(summary).toContain('Error 1')
    expect(summary).toContain('Error 2')
  })

  it('initErrorCapture returns noop cleanup when window is undefined', async () => {
    // In Node/test env, window is not defined by default in module scope
    // but vitest may have jsdom — either way, the function should not throw
    const { initErrorCapture } = await import('@/lib/feedback-errors')
    const cleanup = initErrorCapture()
    expect(typeof cleanup).toBe('function')
    cleanup()
  })
})
