/**
 * sendEmailExecutor.test.ts
 *
 * TDD tests for SendEmailExecutor.
 *
 * Covers:
 *   - Creates outbound_messages row with status='queued' before sending
 *   - Calls mailer.sendEmail with correct params
 *   - Updates status to 'sent' with provider ID on success
 *   - Updates status to 'failed' with error on mailer throw
 *   - reply_token included in outbound_messages row when provided
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SendEmailExecutor } from '../commands/executors/sendEmailExecutor'
import type { AgentCommand } from '../commands/commandBus'
import type { SendEmailPayload } from '../commands/executors/sendEmailExecutor'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makePayload = (overrides: Partial<SendEmailPayload> = {}): SendEmailPayload => ({
  recipientEmail: 'dan@example.com',
  recipientName: 'Dan',
  subject: 'Checking in',
  body: '<p>Hey Dan! We miss you.</p>',
  gymId: 'gym-001',
  sentByAgent: 'retention',
  taskId: 'task-001',
  ...overrides,
})

const makeCommand = (payload: SendEmailPayload, overrides: Partial<AgentCommand> = {}): AgentCommand => ({
  id: 'cmd-001',
  gymId: 'gym-001',
  commandType: 'SendEmail',
  payload: payload as unknown as Record<string, unknown>,
  issuedByAgent: 'retention',
  taskId: 'task-001',
  status: 'pending',
  attempts: 0,
  maxAttempts: 3,
  nextAttemptAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...overrides,
})

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeDeps(overrides: {
  sendEmail?: (params: any) => Promise<{ id: string }>
  createOutboundMessage?: (msg: any) => Promise<{ id: string }>
  updateOutboundMessageStatus?: (id: string, status: string, opts?: any) => Promise<void>
} = {}) {
  const mailer = {
    sendEmail: overrides.sendEmail ?? vi.fn().mockResolvedValue({ id: 'resend-provider-id-001' }),
  }

  const db = {
    createOutboundMessage: overrides.createOutboundMessage ?? vi.fn().mockResolvedValue({ id: 'outbound-msg-001' }),
    updateOutboundMessageStatus: overrides.updateOutboundMessageStatus ?? vi.fn().mockResolvedValue(undefined),
  }

  return { mailer, db }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SendEmailExecutor.execute()', () => {
  it('creates outbound_messages row with status=queued BEFORE sending email', async () => {
    const callOrder: string[] = []

    const deps = makeDeps({
      createOutboundMessage: vi.fn().mockImplementation(async () => {
        callOrder.push('createOutboundMessage')
        return { id: 'outbound-001' }
      }),
      sendEmail: vi.fn().mockImplementation(async () => {
        callOrder.push('sendEmail')
        return { id: 'provider-001' }
      }),
    })

    const executor = new SendEmailExecutor(deps)
    const payload = makePayload()
    const cmd = makeCommand(payload)

    await executor.execute(cmd)

    expect(callOrder[0]).toBe('createOutboundMessage')
    expect(callOrder[1]).toBe('sendEmail')
  })

  it('creates outbound_messages row with status=queued', async () => {
    const deps = makeDeps()
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload()
    const cmd = makeCommand(payload)

    await executor.execute(cmd)

    expect(deps.db.createOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      recipient_email: 'dan@example.com',
      recipient_name: 'Dan',
      subject: 'Checking in',
    }))
  })

  it('calls mailer.sendEmail with correct params', async () => {
    const deps = makeDeps()
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload()
    const cmd = makeCommand(payload)

    await executor.execute(cmd)

    expect(deps.mailer.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'dan@example.com',
      subject: 'Checking in',
      html: '<p>Hey Dan! We miss you.</p>',
    }))
  })

  it('updates status to sent with provider ID on success', async () => {
    const deps = makeDeps()
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload()
    const cmd = makeCommand(payload)

    await executor.execute(cmd)

    expect(deps.db.updateOutboundMessageStatus).toHaveBeenCalledWith(
      'outbound-msg-001',
      'sent',
      expect.objectContaining({ providerId: 'resend-provider-id-001' }),
    )
  })

  it('updates status to failed with error message on mailer throw', async () => {
    const deps = makeDeps({
      sendEmail: vi.fn().mockRejectedValue(new Error('Resend API rate limit')),
    })
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload()
    const cmd = makeCommand(payload)

    // Executor should rethrow so CommandBus can handle retry/dead-letter
    await expect(executor.execute(cmd)).rejects.toThrow('Resend API rate limit')

    // But it should have updated the row to failed first
    expect(deps.db.updateOutboundMessageStatus).toHaveBeenCalledWith(
      'outbound-msg-001',
      'failed',
      expect.objectContaining({ failedReason: 'Resend API rate limit' }),
    )
  })

  it('includes reply_token in outbound_messages row when provided', async () => {
    const deps = makeDeps()
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload({ replyToken: 'tok-abc123' })
    const cmd = makeCommand(payload)

    await executor.execute(cmd)

    expect(deps.db.createOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      reply_token: 'tok-abc123',
    }))
  })

  it('omits reply_token when not provided', async () => {
    const deps = makeDeps()
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload() // no replyToken
    const cmd = makeCommand(payload)

    await executor.execute(cmd)

    const call = (deps.db.createOutboundMessage as any).mock.calls[0][0]
    // reply_token should be null or undefined
    expect(call.reply_token == null).toBe(true)
  })

  it('returns { messageId, providerId } on success', async () => {
    const deps = makeDeps()
    const executor = new SendEmailExecutor(deps)
    const payload = makePayload()
    const cmd = makeCommand(payload)

    const result = await executor.execute(cmd)

    expect(result).toEqual({
      messageId: 'outbound-msg-001',
      providerId: 'resend-provider-id-001',
    })
  })
})
