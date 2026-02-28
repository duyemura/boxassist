/**
 * Tests for lib/agents/escalation.ts
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
import { escalateToGM } from '../agents/escalation'

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

function makeConvRow(overrides: Partial<any> = {}) {
  return {
    id: 'conv-1',
    account_id: 'acct-1',
    contact_id: 'member-1',
    contact_name: 'Alex Martinez',
    contact_email: 'alex@example.com',
    contact_phone: null,
    channel: 'email',
    status: 'open',
    assigned_role: 'front_desk',
    session_id: null,
    subject: 'Cancellation request',
    metadata: {},
    created_at: '2024-06-01T10:00:00Z',
    updated_at: '2024-06-01T10:00:00Z',
    ...overrides,
  }
}

function makeMsgRow(overrides: Partial<any> = {}) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    direction: 'inbound',
    channel: 'email',
    content: 'I want to cancel my membership.',
    sender: 'Alex Martinez',
    external_id: null,
    metadata: {},
    created_at: '2024-06-01T10:00:00Z',
    ...overrides,
  }
}

async function* fakeSessionGenerator(events: Array<Record<string, unknown>>) {
  for (const event of events) {
    yield event
  }
}

const defaultConfig = { apiKey: 'key', companyId: 'co' }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('escalateToGM', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reassigns conversation to gm and starts a GM session', async () => {
    // getConversation
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow()) as any)
      // reassignConversation: update + eq
      .mockReturnValueOnce(makeChain(null) as any)
      // getConversationMessages
      .mockReturnValueOnce(makeChain([makeMsgRow()]) as any)
      // linkSession: update + eq
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'gm-sess-1' },
        { type: 'message', content: 'Looking into the cancellation...' },
        { type: 'done', summary: 'Handled escalation' },
      ]),
    )

    const events = []
    for await (const event of escalateToGM('conv-1', 'Client wants to cancel', undefined, defaultConfig)) {
      events.push(event)
    }

    // Should start a GM session with the gm role
    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        role: 'gm',
        tools: ['data', 'conversation', 'action', 'learning'],
        autonomyMode: 'semi_auto',
        createdBy: 'event',
      }),
    )

    // Should yield all events
    expect(events[0]).toEqual({ type: 'session_created', sessionId: 'gm-sess-1' })
    expect(events).toHaveLength(3)
  })

  it('includes escalation reason in the goal', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow()) as any)
      .mockReturnValueOnce(makeChain(null) as any)
      .mockReturnValueOnce(makeChain([makeMsgRow()]) as any)
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'gm-sess-2' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    for await (const _ of escalateToGM('conv-1', 'Client wants a refund', 'Long-time member, 2 years', defaultConfig)) {
      // consume
    }

    const goalArg = (mockStartSession.mock.calls[0][0] as any).goal
    expect(goalArg).toContain('Escalation from Front Desk')
    expect(goalArg).toContain('Client wants a refund')
    expect(goalArg).toContain('Long-time member, 2 years')
    expect(goalArg).toContain('conv-1')
  })

  it('includes conversation history in the goal', async () => {
    const messages = [
      makeMsgRow({ id: 'msg-1', direction: 'outbound', content: 'Welcome!', sender: 'front_desk', created_at: '2024-06-01T09:00:00Z' }),
      makeMsgRow({ id: 'msg-2', direction: 'inbound', content: 'I want to cancel.', sender: 'Alex', created_at: '2024-06-01T10:00:00Z' }),
    ]

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow()) as any)
      .mockReturnValueOnce(makeChain(null) as any)
      .mockReturnValueOnce(makeChain(messages) as any)
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'gm-sess-3' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    for await (const _ of escalateToGM('conv-1', 'Cancellation', undefined, defaultConfig)) {
      // consume
    }

    const goalArg = (mockStartSession.mock.calls[0][0] as any).goal
    expect(goalArg).toContain('Full Conversation History (2 messages)')
    expect(goalArg).toContain('Welcome!')
    expect(goalArg).toContain('I want to cancel.')
  })

  it('yields error when conversation not found', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { code: 'PGRST116', message: 'not found' }) as any)

    const events = []
    for await (const event of escalateToGM('nonexistent', 'test', undefined, defaultConfig)) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as any).message).toContain('not found')
  })

  it('links session to conversation after creation', async () => {
    const linkChain = makeChain(null)

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow()) as any)
      .mockReturnValueOnce(makeChain(null) as any)        // reassignConversation
      .mockReturnValueOnce(makeChain([]) as any)            // getConversationMessages
      .mockReturnValueOnce(linkChain as any)                // linkSession

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'gm-sess-link' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    const events = []
    for await (const event of escalateToGM('conv-1', 'test', undefined, defaultConfig)) {
      events.push(event)
    }

    // linkSession updates the conversations table
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledWith('conversations')
  })

  it('uses custom maxTurns and budgetCents', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow()) as any)
      .mockReturnValueOnce(makeChain(null) as any)
      .mockReturnValueOnce(makeChain([]) as any)
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'gm-sess-4' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    for await (const _ of escalateToGM('conv-1', 'test', undefined, {
      apiKey: 'key',
      companyId: 'co',
      maxTurns: 8,
      budgetCents: 30,
    })) {
      // consume
    }

    expect(mockStartSession).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTurns: 8,
        budgetCents: 30,
      }),
    )
  })

  it('includes contact info in the goal', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow({ contact_phone: '+15551234567' })) as any)
      .mockReturnValueOnce(makeChain(null) as any)
      .mockReturnValueOnce(makeChain([]) as any)
      .mockReturnValueOnce(makeChain(null) as any)

    mockStartSession.mockReturnValue(
      fakeSessionGenerator([
        { type: 'session_created', sessionId: 'gm-sess-5' },
        { type: 'done', summary: 'Done' },
      ]),
    )

    for await (const _ of escalateToGM('conv-1', 'test', undefined, defaultConfig)) {
      // consume
    }

    const goalArg = (mockStartSession.mock.calls[0][0] as any).goal
    expect(goalArg).toContain('Alex Martinez')
    expect(goalArg).toContain('alex@example.com')
    expect(goalArg).toContain('+15551234567')
    expect(goalArg).toContain('send_reply')
  })
})
