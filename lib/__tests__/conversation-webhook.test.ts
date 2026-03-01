/**
 * Tests for app/api/webhooks/conversation/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockRouteInbound,
  mockHandleInbound,
  mockHandoffConversation,
  mockSupabaseFrom,
  mockDecrypt,
} = vi.hoisted(() => ({
  mockRouteInbound: vi.fn(),
  mockHandleInbound: vi.fn(),
  mockHandoffConversation: vi.fn(),
  mockSupabaseFrom: vi.fn(),
  mockDecrypt: vi.fn((val: string) => `decrypted_${val}`),
}))

// ── Mock modules ─────────────────────────────────────────────────────────────

vi.mock('@/lib/channel-router', () => ({
  routeInbound: mockRouteInbound,
}))

vi.mock('@/lib/agents/front-desk', () => ({
  handleInbound: mockHandleInbound,
}))

vi.mock('@/lib/agents/escalation', () => ({
  handoffConversation: mockHandoffConversation,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (...args: any[]) => mockSupabaseFrom(...args) },
}))

vi.mock('@/lib/encrypt', () => ({
  decrypt: mockDecrypt,
}))

// ── Import route handler ──────────────────────────────────────────────────────

import { POST } from '../../app/api/webhooks/conversation/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: any, error: any = null) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    then: (resolve: any) => resolve({ data, error }),
  }
  return chain
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost/api/webhooks/conversation'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeRouteResult(overrides: Partial<any> = {}) {
  return {
    conversation: {
      id: 'conv-1',
      accountId: 'acct-1',
      contactId: 'member-1',
      contactName: 'Alex',
      contactEmail: 'alex@example.com',
      contactPhone: null,
      channel: 'email',
      status: 'open',
      assignedRole: 'front_desk',
      sessionId: null,
      subject: null,
      metadata: {},
      createdAt: '2024-06-01T10:00:00Z',
      updatedAt: '2024-06-01T10:00:00Z',
    },
    message: {
      id: 'msg-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      channel: 'email',
      content: 'Hello',
      sender: 'Alex',
      externalId: null,
      metadata: {},
      createdAt: '2024-06-01T10:01:00Z',
    },
    isNew: true,
    assignedRole: 'front_desk',
    ...overrides,
  }
}

async function* fakeEvents(events: Array<Record<string, unknown>>) {
  for (const e of events) {
    yield e
  }
}

const validBody = {
  account_id: 'acct-1',
  channel: 'email',
  content: 'Hello, I have a question.',
  contact_id: 'member-1',
  contact_name: 'Alex',
  contact_email: 'alex@example.com',
}

const accountRow = {
  id: 'acct-1',
  pushpress_api_key: 'encrypted_key',
  pushpress_company_id: 'co-1',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/conversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for missing required fields', async () => {
    const res = await POST(makeRequest({ account_id: 'acct-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Missing required fields')
  })

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest(new URL('http://localhost/api/webhooks/conversation'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid JSON')
  })

  it('returns 404 when account not found', async () => {
    mockSupabaseFrom.mockReturnValueOnce(
      makeChain(null, { message: 'not found' }),
    )

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Account not found')
  })

  it('routes to front desk and returns 200', async () => {
    // Account lookup
    mockSupabaseFrom.mockReturnValueOnce(makeChain(accountRow))

    // routeInbound returns a front_desk route
    mockRouteInbound.mockResolvedValueOnce(makeRouteResult())

    // handleInbound yields session events
    mockHandleInbound.mockReturnValueOnce(
      fakeEvents([
        { type: 'session_created', sessionId: 'sess-1' },
        { type: 'message', content: 'Responding...' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.conversationId).toBe('conv-1')
    expect(body.isNew).toBe(true)
    expect(body.assignedRole).toBe('front_desk')
    expect(body.sessionId).toBe('sess-1')
    expect(body.eventsProcessed).toBe(3)

    // Verify routeInbound was called with correct params
    expect(mockRouteInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        channel: 'email',
        content: 'Hello, I have a question.',
        contactId: 'member-1',
        contactName: 'Alex',
        contactEmail: 'alex@example.com',
      }),
    )

    // Verify decrypt was called on the api key
    expect(mockDecrypt).toHaveBeenCalledWith('encrypted_key')
  })

  it('routes to GM for escalated conversations', async () => {
    mockSupabaseFrom.mockReturnValueOnce(makeChain(accountRow))

    // Route to GM-assigned conversation
    mockRouteInbound.mockResolvedValueOnce(
      makeRouteResult({ assignedRole: 'gm' }),
    )

    mockHandoffConversation.mockReturnValueOnce(
      fakeEvents([
        { type: 'session_created', sessionId: 'gm-sess-1' },
        { type: 'done', summary: 'GM handled' },
      ]),
    )

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.assignedRole).toBe('gm')
    expect(body.sessionId).toBe('gm-sess-1')
    expect(body.eventsProcessed).toBe(2)

    expect(mockHandoffConversation).toHaveBeenCalledWith(
      'conv-1',
      'gm',
      expect.stringContaining('Continuing conversation'),
      undefined,
      expect.objectContaining({
        apiKey: 'decrypted_encrypted_key',
        companyId: 'co-1',
      }),
    )
  })

  it('routes any non-front_desk role through generic handoff', async () => {
    mockSupabaseFrom.mockReturnValueOnce(makeChain(accountRow))

    mockRouteInbound.mockResolvedValueOnce(
      makeRouteResult({ assignedRole: 'sales_agent' }),
    )

    mockHandoffConversation.mockReturnValueOnce(
      fakeEvents([
        { type: 'session_created', sessionId: 'sales-sess-1' },
        { type: 'done', summary: 'Sales handled' },
      ]),
    )

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.assignedRole).toBe('sales_agent')
    expect(body.eventsProcessed).toBe(2)

    expect(mockHandoffConversation).toHaveBeenCalledWith(
      'conv-1',
      'sales_agent',
      expect.stringContaining('Continuing conversation'),
      undefined,
      expect.objectContaining({ apiKey: 'decrypted_encrypted_key' }),
    )
  })

  it('handles empty API key gracefully', async () => {
    mockSupabaseFrom.mockReturnValueOnce(
      makeChain({ id: 'acct-1', pushpress_api_key: null, pushpress_company_id: null }),
    )

    mockRouteInbound.mockResolvedValueOnce(makeRouteResult())
    mockHandleInbound.mockReturnValueOnce(fakeEvents([
      { type: 'session_created', sessionId: 'sess-2' },
      { type: 'done', summary: 'Done' },
    ]))

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)

    // decrypt should NOT be called if key is null
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  it('returns 500 on internal error', async () => {
    mockSupabaseFrom.mockReturnValueOnce(makeChain(accountRow))
    mockRouteInbound.mockRejectedValueOnce(new Error('DB connection failed'))

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.error).toContain('DB connection failed')
  })
})
