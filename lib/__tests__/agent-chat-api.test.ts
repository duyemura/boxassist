/**
 * agent-chat-api.test.ts
 *
 * Tests for the /api/agents/chat endpoint.
 * Validates: auth, start session, resume with message,
 * approve/reject tools, SSE format.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

const mockStartSession = vi.fn()
const mockResumeSession = vi.fn()
const mockLoadSession = vi.fn()

vi.mock('@/lib/agents/session-runtime', () => ({
  startSession: (...args: unknown[]) => mockStartSession(...args),
  resumeSession: (...args: unknown[]) => mockResumeSession(...args),
  loadSession: (...args: unknown[]) => mockLoadSession(...args),
}))

const mockSupabaseFrom = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}))

vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: vi.fn().mockResolvedValue({
    id: 'acct-001',
    pushpress_api_key: 'encrypted-test-key',
    pushpress_company_id: 'test-company',
  }),
}))

vi.mock('@/lib/encrypt', () => ({
  decrypt: vi.fn().mockReturnValue('test-key'),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { GET, POST } from '@/app/api/agents/chat/route'
import { NextRequest } from 'next/server'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq(body: unknown, method = 'POST') {
  return new NextRequest('http://localhost:3000/api/agents/chat', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeGetReq(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/agents/chat')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url, { method: 'GET' })
}

async function* fakeGenerator(events: Array<Record<string, unknown>>) {
  for (const event of events) {
    yield event
  }
}

async function readSSEResponse(response: Response): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value)
  }
  return result
}

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Default: authenticated user
  mockGetSession.mockResolvedValue({ id: 'user-1', email: 'owner@test.com' })

  // Default: user has an account
  mockSupabaseFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'user-1', email: 'owner@test.com' },
          error: null,
        }),
      }),
    }),
  })
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('POST /api/agents/chat', () => {
  it('returns 401 for unauthenticated requests', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(makeReq({ action: 'start', goal: 'test' }))
    expect(response.status).toBe(401)
  })

  it('returns 400 for invalid action', async () => {
    const response = await POST(makeReq({ action: 'invalid' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 for missing action', async () => {
    const response = await POST(makeReq({}))
    expect(response.status).toBe(400)
  })

  it('streams SSE events for start action', async () => {
    mockStartSession.mockReturnValue(
      fakeGenerator([
        { type: 'session_created', sessionId: 'sess-1' },
        { type: 'message', content: 'Analyzing...' },
        { type: 'done', summary: 'Complete' },
      ]),
    )

    const response = await POST(makeReq({ action: 'start', goal: 'Analyze retention' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')

    const body = await readSSEResponse(response)
    expect(body).toContain('session_created')
    expect(body).toContain('Analyzing...')
    expect(body).toContain('Complete')
  })

  it('streams SSE events for message action', async () => {
    mockResumeSession.mockReturnValue(
      fakeGenerator([
        { type: 'message', content: 'Got your message.' },
      ]),
    )

    const response = await POST(makeReq({
      action: 'message',
      sessionId: 'sess-1',
      content: 'Focus on new members',
    }))

    expect(response.status).toBe(200)
    const body = await readSSEResponse(response)
    expect(body).toContain('Got your message')
  })

  it('streams SSE events for approve action', async () => {
    mockResumeSession.mockReturnValue(
      fakeGenerator([
        { type: 'tool_result', name: 'send_email', result: { status: 'queued' } },
      ]),
    )

    const response = await POST(makeReq({
      action: 'approve',
      sessionId: 'sess-1',
      approvals: { 'tool-call-1': true },
    }))

    expect(response.status).toBe(200)
    const body = await readSSEResponse(response)
    expect(body).toContain('tool_result')
  })

  it('sends error for start without goal', async () => {
    const response = await POST(makeReq({ action: 'start' }))
    expect(response.status).toBe(200) // SSE stream
    const body = await readSSEResponse(response)
    expect(body).toContain('goal is required')
  })

  it('sends error for message without sessionId', async () => {
    const response = await POST(makeReq({ action: 'message', content: 'hello' }))
    expect(response.status).toBe(200)
    const body = await readSSEResponse(response)
    expect(body).toContain('sessionId is required')
  })
})

describe('GET /api/agents/chat', () => {
  it('returns 401 for unauthenticated requests', async () => {
    mockGetSession.mockResolvedValue(null)
    const response = await GET(makeGetReq({ sessionId: 'sess-1' }))
    expect(response.status).toBe(401)
  })

  it('returns 400 when sessionId is missing', async () => {
    const response = await GET(makeGetReq({}))
    expect(response.status).toBe(400)
  })

  it('returns 404 when session not found', async () => {
    mockLoadSession.mockResolvedValue(null)
    const response = await GET(makeGetReq({ sessionId: 'nonexistent' }))
    expect(response.status).toBe(404)
  })

  it('returns session state for valid session', async () => {
    mockLoadSession.mockResolvedValue({
      id: 'sess-1',
      accountId: 'acct-001',
      status: 'waiting_approval',
      autonomyMode: 'semi_auto',
      turnCount: 3,
      costCents: 15,
      pendingApprovals: [{ toolUseId: 'tc-1', name: 'send_email', input: {} }],
      outputs: [],
      goal: 'Analyze retention',
      createdAt: '2026-02-27T10:00:00Z',
    })

    const response = await GET(makeGetReq({ sessionId: 'sess-1' }))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.sessionId).toBe('sess-1')
    expect(body.status).toBe('waiting_approval')
    expect(body.pendingApprovals).toHaveLength(1)
  })
})
