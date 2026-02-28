/**
 * Tests for lib/agents/front-desk.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockStartSession = vi.fn()
vi.mock('../agents/session-runtime', () => ({
  startSession: (...args: unknown[]) => mockStartSession(...args),
}))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '../supabase'
import { handleInbound } from '../agents/front-desk'
import type { RouteResult } from '../channel-router'

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

function makeRouteResult(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    conversation: {
      id: 'conv-1',
      accountId: 'acct-1',
      contactId: 'member-1',
      contactName: 'Alex Martinez',
      contactEmail: 'alex@example.com',
      contactPhone: null,
      channel: 'email',
      status: 'open',
      assignedRole: 'front_desk',
      sessionId: null,
      subject: 'Question about membership',
      metadata: {},
      createdAt: '2024-06-01T10:00:00Z',
      updatedAt: '2024-06-01T10:00:00Z',
    },
    message: {
      id: 'msg-1',
      conversationId: 'conv-1',
      direction: 'inbound',
      channel: 'email',
      content: 'Hey, I was thinking about cancelling my membership. What options do I have?',
      sender: 'Alex Martinez',
      externalId: null,
      metadata: {},
      createdAt: '2024-06-01T10:01:00Z',
    },
    isNew: true,
    assignedRole: 'front_desk',
    ...overrides,
  }
}

async function* fakeSessionGenerator(events: Array<Record<string, unknown>>) {
  for (const event of events) {
    yield event
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a session with the front-desk role', async () => {
    // Mock getConversationMessages
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([]) as any)    // conversation_messages: empty history
      .mockReturnValueOnce(makeChain(null) as any)   // linkSession: update

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'sess-1' },
        { type: 'message', content: 'Responding to Alex...' },
        { type: 'done', summary: 'Response sent' },
      ]),
    )

    const events = []
    for await (const event of handleInbound(makeRouteResult(), { apiKey: 'key', companyId: 'co' })) {
      events.push(event)
    }

    // Verify session was started with correct config
    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        role: 'front-desk',
        tools: ['data', 'conversation', 'learning'],
        autonomyMode: 'full_auto',
        createdBy: 'event',
      }),
    )

    // Verify events were yielded
    expect(events[0]).toEqual({ type: 'session_created', sessionId: 'sess-1' })
    expect(events).toHaveLength(3)
  })

  it('includes conversation history in the goal', async () => {
    // Mock getConversationMessages with prior history
    const priorMessages = [
      { id: 'msg-0', conversation_id: 'conv-1', direction: 'outbound', channel: 'email', content: 'Welcome to the gym!', sender: 'front_desk', external_id: null, metadata: {}, created_at: '2024-06-01T09:00:00Z' },
      { id: 'msg-1', conversation_id: 'conv-1', direction: 'inbound', channel: 'email', content: 'Thinking about cancelling', sender: 'Alex', external_id: null, metadata: {}, created_at: '2024-06-01T10:01:00Z' },
    ]

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(priorMessages) as any)
      .mockReturnValueOnce(makeChain(null) as any) // linkSession

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'sess-2' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    const events = []
    for await (const event of handleInbound(makeRouteResult(), { apiKey: 'key', companyId: 'co' })) {
      events.push(event)
    }

    // Goal should include conversation history
    const goalArg = (mockStartSession.mock.calls[0][0] as any).goal
    expect(goalArg).toContain('Conversation History')
    expect(goalArg).toContain('Welcome to the gym!')
    expect(goalArg).toContain('Conversation ID')
    expect(goalArg).toContain('conv-1')
  })

  it('includes contact info in the goal', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([]) as any)
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'sess-3' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    for await (const _ of handleInbound(makeRouteResult(), { apiKey: 'key', companyId: 'co' })) {
      // consume
    }

    const goalArg = (mockStartSession.mock.calls[0][0] as any).goal
    expect(goalArg).toContain('Alex Martinez')
    expect(goalArg).toContain('alex@example.com')
    expect(goalArg).toContain('send_reply')
  })

  it('links session to conversation after creation', async () => {
    // linkSession calls supabaseAdmin.from('conversations').update().eq()
    const linkChain = makeChain(null)

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([]) as any)     // getConversationMessages
      .mockReturnValueOnce(linkChain as any)          // linkSession

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'sess-link-1' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    const events = []
    for await (const event of handleInbound(makeRouteResult(), { apiKey: 'key', companyId: 'co' })) {
      events.push(event)
    }

    // linkSession should have been called (updates conversations table)
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledWith('conversations')
  })

  it('uses custom maxTurns and budgetCents', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([]) as any)
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'sess-4' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    for await (const _ of handleInbound(makeRouteResult(), {
      apiKey: 'key',
      companyId: 'co',
      maxTurns: 5,
      budgetCents: 25,
    })) {
      // consume
    }

    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTurns: 5,
        budgetCents: 25,
      }),
    )
  })
})
