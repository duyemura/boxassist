/**
 * Tests for lib/db/conversations.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '../supabase'
import {
  getConversations,
  getConversation,
  findOpenConversation,
  createConversation,
  addMessage,
  updateConversationStatus,
  reassignConversation,
} from '../db/conversations'

// ── Test helpers ──────────────────────────────────────────────────────────────

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
    subject: 'Re-engagement',
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
    direction: 'outbound',
    channel: 'email',
    content: 'Hey Alex, how are you doing?',
    sender: 'front_desk',
    external_id: null,
    metadata: {},
    created_at: '2024-06-01T10:00:00Z',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getConversations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns mapped conversations on success', async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [makeConvRow()], error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const result = await getConversations('acct-1')
    expect(result).toHaveLength(1)
    expect(result[0].contactName).toBe('Alex Martinez')
    expect(result[0].assignedRole).toBe('front_desk')
    expect(result[0].status).toBe('open')
  })

  it('throws on DB error', async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB fail' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    await expect(getConversations('acct-1')).rejects.toThrow('getConversations failed')
  })
})

describe('getConversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null for PGRST116 (not found)', async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    expect(await getConversation('nope')).toBeNull()
  })

  it('returns conversation when found', async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: makeConvRow(), error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const conv = await getConversation('conv-1')
    expect(conv?.id).toBe('conv-1')
    expect(conv?.channel).toBe('email')
  })
})

describe('createConversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates and returns the new conversation', async () => {
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: makeConvRow(), error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const conv = await createConversation({
      accountId: 'acct-1',
      contactId: 'member-1',
      contactName: 'Alex Martinez',
      contactEmail: 'alex@example.com',
      channel: 'email',
    })

    expect(conv.contactName).toBe('Alex Martinez')
    expect(conv.channel).toBe('email')
    expect(conv.assignedRole).toBe('front_desk')
  })
})

describe('addMessage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts message and touches conversation updated_at', async () => {
    // First call: insert message
    const insertChain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: makeMsgRow(), error: null }),
    }
    // Second call: update conversation
    const updateChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(insertChain as any)
      .mockReturnValueOnce(updateChain as any)

    const msg = await addMessage({
      conversationId: 'conv-1',
      direction: 'outbound',
      channel: 'email',
      content: 'Hey Alex!',
      sender: 'front_desk',
    })

    expect(msg.content).toBe('Hey Alex, how are you doing?')
    expect(msg.direction).toBe('outbound')
  })
})

describe('updateConversationStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates status without error', async () => {
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    await expect(updateConversationStatus('conv-1', 'resolved')).resolves.toBeUndefined()
  })
})

describe('reassignConversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reassigns role and optionally updates status', async () => {
    const chain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    await expect(reassignConversation('conv-1', 'gm', 'escalated')).resolves.toBeUndefined()
  })
})
