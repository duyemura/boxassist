/**
 * Tests for conversation-tools.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('../db/commands', () => ({
  insertCommand: vi.fn().mockResolvedValue(undefined),
}))

const mockReassignConversation = vi.fn().mockResolvedValue(undefined)
vi.mock('../db/conversations', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    reassignConversation: (...args: any[]) => mockReassignConversation(...args),
  }
})

import { supabaseAdmin } from '../supabase'
import { conversationToolGroup } from '../agents/tools/conversation-tools'
import type { ToolContext } from '../agents/tools/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: any, error: any = null) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    then: (resolve: any) => resolve({ data, error }),
  }
  return chain
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    accountId: 'acct-1',
    apiKey: 'test-key',
    companyId: 'test-company',
    sessionId: 'session-1',
    autopilotLevel: 'full',
    autonomyMode: 'full_auto',
    workingSet: { processed: [], emailed: [], skipped: [] },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('conversation tool group', () => {
  it('exports get_conversation_history, send_reply, and handoff_conversation tools', () => {
    expect(conversationToolGroup.name).toBe('conversation')
    expect(conversationToolGroup.tools).toHaveLength(3)
    expect(conversationToolGroup.tools.map(t => t.name)).toEqual([
      'get_conversation_history',
      'send_reply',
      'handoff_conversation',
    ])
  })
})

describe('get_conversation_history', () => {
  const tool = conversationToolGroup.tools.find(t => t.name === 'get_conversation_history')!

  beforeEach(() => vi.clearAllMocks())

  it('returns messages in chronological order', async () => {
    const messages = [
      { id: 'msg-1', conversation_id: 'conv-1', direction: 'inbound', channel: 'email', content: 'Hello', sender: 'Alex', external_id: null, metadata: {}, created_at: '2024-06-01T10:00:00Z' },
      { id: 'msg-2', conversation_id: 'conv-1', direction: 'outbound', channel: 'email', content: 'Hi Alex!', sender: 'front_desk', external_id: null, metadata: {}, created_at: '2024-06-01T10:01:00Z' },
    ]

    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(messages) as any)

    const result = await tool.execute({ conversation_id: 'conv-1' }, makeCtx()) as any

    expect(result.count).toBe(2)
    expect(result.messages[0].direction).toBe('inbound')
    expect(result.messages[0].content).toBe('Hello')
    expect(result.messages[1].direction).toBe('outbound')
  })

  it('returns error on failure', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(
      makeChain(null, { message: 'DB error' }) as any,
    )

    const result = await tool.execute({ conversation_id: 'conv-1' }, makeCtx()) as any
    expect(result.error).toContain('Failed to load conversation')
  })

  it('does not require approval', () => {
    expect(tool.requiresApproval).toBe(false)
  })
})

describe('send_reply', () => {
  const tool = conversationToolGroup.tools.find(t => t.name === 'send_reply')!

  beforeEach(() => vi.clearAllMocks())

  it('sends email reply and records in conversation', async () => {
    const convRow = {
      id: 'conv-1', account_id: 'acct-1', contact_id: 'member-1',
      contact_name: 'Alex', contact_email: 'alex@example.com', contact_phone: null,
      channel: 'email', status: 'open', assigned_role: 'front_desk',
      session_id: null, subject: 'Re: Your membership', metadata: {}, created_at: 'x', updated_at: 'x',
    }

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(convRow) as any)         // getConversation
      .mockReturnValueOnce(makeChain(null) as any)             // opt-out check (no opt-out)
      .mockReturnValueOnce(makeChain(null, null) as any)       // daily send count (count=0 via data:null)
      .mockReturnValueOnce(makeChain({ id: 'msg-out-1' }) as any) // insert outbound_messages
      .mockReturnValueOnce(makeChain({ id: 'msg-conv-1' }) as any) // addMessage: insert to conversation_messages
      .mockReturnValueOnce(makeChain(null) as any)             // addMessage: touch updated_at

    const result = await tool.execute({
      conversation_id: 'conv-1',
      content: 'Hey Alex, glad to help!',
    }, makeCtx()) as any

    expect(result.status).toBe('queued')
    expect(result.channel).toBe('email')
    expect(result.conversationId).toBe('conv-1')
  })

  it('blocks opted-out contacts', async () => {
    const convRow = {
      id: 'conv-1', account_id: 'acct-1', contact_id: 'member-1',
      contact_name: 'Alex', contact_email: 'alex@example.com', contact_phone: null,
      channel: 'email', status: 'open', assigned_role: 'front_desk',
      session_id: null, subject: null, metadata: {}, created_at: 'x', updated_at: 'x',
    }

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(convRow) as any)
      .mockReturnValueOnce(makeChain({ id: 'optout-1' }) as any) // has opt-out

    const result = await tool.execute({
      conversation_id: 'conv-1',
      content: 'Hello',
    }, makeCtx()) as any

    expect(result.error).toContain('opted out')
  })

  it('requires approval in semi_auto mode', () => {
    const fn = tool.requiresApproval as Function
    expect(fn({}, makeCtx({ autonomyMode: 'semi_auto' }))).toBe(true)
    expect(fn({}, makeCtx({ autonomyMode: 'full_auto' }))).toBe(false)
  })

  it('returns error for unsupported channel', async () => {
    const convRow = {
      id: 'conv-1', account_id: 'acct-1', contact_id: 'member-1',
      contact_name: 'Alex', contact_email: null, contact_phone: null,
      channel: 'instagram', status: 'open', assigned_role: 'front_desk',
      session_id: null, subject: null, metadata: {}, created_at: 'x', updated_at: 'x',
    }

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(convRow) as any)
      .mockReturnValueOnce(makeChain(null) as any)  // opt-out check (no contact field, skips)
      .mockReturnValueOnce(makeChain(null) as any)  // daily count

    const result = await tool.execute({
      conversation_id: 'conv-1',
      content: 'Hello',
    }, makeCtx()) as any

    expect(result.error).toContain('not yet supported')
  })

  it('returns error when conversation not found', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { code: 'PGRST116', message: 'not found' }) as any)

    const result = await tool.execute({
      conversation_id: 'nonexistent',
      content: 'Hello',
    }, makeCtx()) as any

    expect(result.error).toContain('not found')
  })
})

describe('handoff_conversation', () => {
  const tool = conversationToolGroup.tools.find(t => t.name === 'handoff_conversation')!

  beforeEach(() => vi.clearAllMocks())

  it('defaults to gm when no target_role specified', async () => {
    mockReassignConversation.mockResolvedValueOnce(undefined)

    const result = await tool.execute({
      conversation_id: 'conv-1',
      reason: 'Client wants to cancel their membership',
    }, makeCtx()) as any

    expect(result.handedOff).toBe(true)
    expect(result.newRole).toBe('gm')
    expect(result.conversationId).toBe('conv-1')
    expect(result.reason).toContain('cancel')

    expect(mockReassignConversation).toHaveBeenCalledWith('conv-1', 'gm', 'escalated')
  })

  it('hands off to a specified target role', async () => {
    mockReassignConversation.mockResolvedValueOnce(undefined)

    const result = await tool.execute({
      conversation_id: 'conv-1',
      target_role: 'sales_agent',
      reason: 'Client interested in personal training upsell',
    }, makeCtx()) as any

    expect(result.handedOff).toBe(true)
    expect(result.newRole).toBe('sales_agent')
    expect(result.conversationId).toBe('conv-1')

    expect(mockReassignConversation).toHaveBeenCalledWith('conv-1', 'sales_agent', 'escalated')
  })

  it('returns error on DB failure', async () => {
    mockReassignConversation.mockRejectedValueOnce(new Error('DB error'))

    const result = await tool.execute({
      conversation_id: 'conv-1',
      reason: 'test',
    }, makeCtx()) as any

    expect(result.error).toContain('Failed to hand off')
    expect(result.error).toContain('DB error')
  })

  it('does not require approval', () => {
    expect(tool.requiresApproval).toBe(false)
  })
})
