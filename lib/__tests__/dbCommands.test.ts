/**
 * dbCommands.test.ts
 *
 * TDD tests for lib/db/commands.ts DB helper functions.
 * Uses vi.mock for the supabase module to control what supabaseAdmin returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock the supabase module ──────────────────────────────────────────────────
// Use vi.hoisted() so mockFrom is available inside the hoisted vi.mock factory.

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: mockFrom,
  },
  supabase: {
    from: vi.fn(),
  },
}))

// Now import the db/commands module (it will use the mocked supabaseAdmin)
import {
  insertCommand,
  claimPendingCommands,
  completeCommand,
  failCommand,
  deadLetterCommand,
  createOutboundMessage,
  updateOutboundMessageStatus,
} from '../db/commands'
import type { AgentCommand } from '../commands/commandBus'

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeDbCommand = (overrides: Partial<AgentCommand> = {}): AgentCommand => ({
  id: 'cmd-db-001',
  gymId: 'gym-001',
  commandType: 'SendEmail',
  payload: { recipientEmail: 'dan@example.com' },
  issuedByAgent: 'retention',
  taskId: 'task-001',
  status: 'pending',
  attempts: 0,
  maxAttempts: 3,
  nextAttemptAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...overrides,
})

/** Build a fluent Supabase mock chain that resolves to given data/error */
function makeChain(resolvedValue: { data: any; error: any }) {
  const chain: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'is', 'or', 'not', 'gte', 'lte', 'lt',
    'single', 'limit', 'order', 'returns',
  ]
  methods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  // Make the chain thenable so `await` resolves to resolvedValue
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(resolvedValue).then(resolve, reject)
  return chain
}

// ─────────────────────────────────────────────────────────────────────────────
// insertCommand tests
// ─────────────────────────────────────────────────────────────────────────────

describe('insertCommand', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('inserts into agent_commands and returns the created record', async () => {
    const dbRow = {
      id: 'new-cmd-001',
      gym_id: 'gym-001',
      command_type: 'SendEmail',
      payload: {},
      issued_by_agent: 'retention',
      task_id: 'task-001',
      status: 'pending',
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    mockFrom.mockReturnValue(makeChain({ data: dbRow, error: null }))

    const { id, createdAt, ...insert } = makeDbCommand()
    const result = await insertCommand(insert as Omit<AgentCommand, 'id' | 'createdAt'>)

    expect(result.id).toBe('new-cmd-001')
    expect(mockFrom).toHaveBeenCalledWith('agent_commands')
  })

  it('throws on DB error', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'insert failed' } }))

    const { id, createdAt, ...insert } = makeDbCommand()
    await expect(insertCommand(insert as Omit<AgentCommand, 'id' | 'createdAt'>)).rejects.toThrow('insert failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// claimPendingCommands tests
// ─────────────────────────────────────────────────────────────────────────────

describe('claimPendingCommands', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('returns pending commands', async () => {
    const dbRows = [
      { id: 'c1', gym_id: 'g1', command_type: 'SendEmail', payload: {}, issued_by_agent: 'ret', status: 'pending', attempts: 0, max_attempts: 3, next_attempt_at: new Date().toISOString(), created_at: new Date().toISOString() },
      { id: 'c2', gym_id: 'g1', command_type: 'SendEmail', payload: {}, issued_by_agent: 'ret', status: 'pending', attempts: 0, max_attempts: 3, next_attempt_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ]
    mockFrom.mockReturnValue(makeChain({ data: dbRows, error: null }))

    const result = await claimPendingCommands(10)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('c1')
  })

  it('returns empty array when no pending commands', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }))

    const result = await claimPendingCommands(10)

    expect(result).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// completeCommand tests
// ─────────────────────────────────────────────────────────────────────────────

describe('completeCommand', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('updates status to succeeded and sets result + completedAt', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await completeCommand('cmd-001', { emailId: 'e123' })

    expect(mockFrom).toHaveBeenCalledWith('agent_commands')
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
      result: { emailId: 'e123' },
    }))
  })

  it('throws on DB error', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'update failed' } }))

    await expect(completeCommand('cmd-001', {})).rejects.toThrow('update failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// failCommand tests
// ─────────────────────────────────────────────────────────────────────────────

describe('failCommand', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('updates status to failed and sets nextAttemptAt and last_error', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    const nextAt = new Date(Date.now() + 2 * 60 * 1000)
    await failCommand('cmd-001', 'SMTP error', nextAt)

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      last_error: 'SMTP error',
      next_attempt_at: nextAt.toISOString(),
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// deadLetterCommand tests
// ─────────────────────────────────────────────────────────────────────────────

describe('deadLetterCommand', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('updates status to dead with last_error', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await deadLetterCommand('cmd-001', 'Max retries exceeded')

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      last_error: 'Max retries exceeded',
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createOutboundMessage tests
// ─────────────────────────────────────────────────────────────────────────────

describe('createOutboundMessage', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('inserts into outbound_messages and returns the created record', async () => {
    const created = {
      id: 'out-msg-001',
      gym_id: 'gym-001',
      status: 'queued',
      channel: 'email',
      recipient_email: 'dan@example.com',
    }
    mockFrom.mockReturnValue(makeChain({ data: created, error: null }))

    const result = await createOutboundMessage({
      gym_id: 'gym-001',
      task_id: null,
      sent_by_agent: 'retention',
      channel: 'email',
      recipient_email: 'dan@example.com',
      recipient_name: 'Dan',
      subject: 'Test',
      body: '<p>Hello</p>',
      status: 'queued',
    } as any)

    expect(result.id).toBe('out-msg-001')
    expect(mockFrom).toHaveBeenCalledWith('outbound_messages')
  })

  it('throws on DB error', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'insert failed' } }))

    await expect(createOutboundMessage({
      gym_id: 'gym-001',
      task_id: null,
      sent_by_agent: 'retention',
      channel: 'email',
      body: 'test',
      status: 'queued',
    } as any)).rejects.toThrow('insert failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// updateOutboundMessageStatus tests
// ─────────────────────────────────────────────────────────────────────────────

describe('updateOutboundMessageStatus', () => {
  beforeEach(() => { mockFrom.mockReset() })

  it('updates status and provider_message_id on sent', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await updateOutboundMessageStatus('out-001', 'sent', { providerId: 'resend-xyz' })

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent',
      provider_message_id: 'resend-xyz',
    }))
  })

  it('updates status and failed_reason on failed', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await updateOutboundMessageStatus('out-001', 'failed', { failedReason: 'Bounce' })

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      failed_reason: 'Bounce',
    }))
  })
})
