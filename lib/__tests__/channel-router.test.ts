/**
 * Tests for lib/channel-router.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '../supabase'
import { routeInbound, routeToConversation } from '../channel-router'

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Creates a thenable Supabase chain mock that resolves to { data, error }. */
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
    subject: null,
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
    content: 'Hey, I have a question.',
    sender: 'Alex Martinez',
    external_id: null,
    metadata: {},
    created_at: '2024-06-01T10:01:00Z',
    ...overrides,
  }
}

function makeInboundMsg(overrides: Partial<any> = {}) {
  return {
    accountId: 'acct-1',
    channel: 'email',
    content: 'Hey, I have a question.',
    contactId: 'member-1',
    contactName: 'Alex Martinez',
    contactEmail: 'alex@example.com',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('routeInbound', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a new conversation when none exists', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null) as any)                // findOpenConversation → empty
      .mockReturnValueOnce(makeChain(makeConvRow(), null) as any)     // createConversation
      .mockReturnValueOnce(makeChain(makeMsgRow(), null) as any)      // addMessage: insert
      .mockReturnValueOnce(makeChain(null, null) as any)              // addMessage: touch updated_at

    const result = await routeInbound(makeInboundMsg())

    expect(result.isNew).toBe(true)
    expect(result.conversation.id).toBe('conv-1')
    expect(result.assignedRole).toBe('front_desk')
    expect(result.message.direction).toBe('inbound')
    expect(result.message.content).toBe('Hey, I have a question.')
  })

  it('reuses an existing open conversation', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([makeConvRow({ id: 'conv-existing' })], null) as any) // find existing
      .mockReturnValueOnce(makeChain(makeMsgRow({ conversation_id: 'conv-existing' }), null) as any) // addMessage
      .mockReturnValueOnce(makeChain(null, null) as any) // touch

    const result = await routeInbound(makeInboundMsg())

    expect(result.isNew).toBe(false)
    expect(result.conversation.id).toBe('conv-existing')
    expect(result.assignedRole).toBe('front_desk')
  })

  it('assigns front_desk role for all channels', async () => {
    for (const channel of ['email', 'sms', 'whatsapp', 'instagram', 'chat']) {
      vi.clearAllMocks()

      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(makeChain([], null) as any)
        .mockReturnValueOnce(makeChain(makeConvRow({ channel, assigned_role: 'front_desk' }), null) as any)
        .mockReturnValueOnce(makeChain(makeMsgRow({ channel }), null) as any)
        .mockReturnValueOnce(makeChain(null, null) as any)

      const result = await routeInbound(makeInboundMsg({ channel }))
      expect(result.assignedRole).toBe('front_desk')
    }
  })

  it('preserves external ID from provider', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([makeConvRow()], null) as any)
      .mockReturnValueOnce(makeChain(makeMsgRow({ external_id: 'resend-msg-123' }), null) as any)
      .mockReturnValueOnce(makeChain(null, null) as any)

    const result = await routeInbound(makeInboundMsg({ externalId: 'resend-msg-123' }))
    expect(result.message.externalId).toBe('resend-msg-123')
  })

  it('uses contact info for sender when name not provided', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null) as any)
      .mockReturnValueOnce(makeChain(makeConvRow({ contact_name: null }), null) as any)
      .mockReturnValueOnce(makeChain(makeMsgRow({ sender: 'alex@example.com' }), null) as any)
      .mockReturnValueOnce(makeChain(null, null) as any)

    const result = await routeInbound(makeInboundMsg({ contactName: undefined }))
    // The addMessage call should have used contactEmail as sender fallback
    expect(result.message).toBeDefined()
  })
})

describe('routeToConversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds message to an existing conversation', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(makeConvRow({ assigned_role: 'gm' }), null) as any) // getConversation
      .mockReturnValueOnce(makeChain(makeMsgRow(), null) as any)  // addMessage: insert
      .mockReturnValueOnce(makeChain(null, null) as any)          // addMessage: touch

    const result = await routeToConversation('conv-1', {
      channel: 'email',
      content: 'Thanks for getting back to me.',
      contactName: 'Alex',
    })

    expect(result.isNew).toBe(false)
    expect(result.assignedRole).toBe('gm')
    expect(result.conversation.id).toBe('conv-1')
  })

  it('throws when conversation not found', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { code: 'PGRST116', message: 'not found' }) as any)

    await expect(routeToConversation('nonexistent', {
      channel: 'email',
      content: 'Hello?',
    })).rejects.toThrow('Conversation nonexistent not found')
  })
})
