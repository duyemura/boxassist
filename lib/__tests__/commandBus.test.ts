/**
 * commandBus.test.ts
 *
 * TDD tests for CommandBus — command issuance, processing, retry, and dead-lettering.
 *
 * Covers:
 *   - issue(): inserts command with correct defaults
 *   - processNext(): claims, executes, marks succeeded
 *   - processNext(): on throw → marks failed with backoff
 *   - processNext(): attempts >= maxAttempts → dead-letters
 *   - processNext(): unknown command type → dead-letters immediately
 *   - Exponential backoff: attempt 1 = +2min, attempt 2 = +10min, attempt 3 = dead
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommandBus } from '../commands/commandBus'
import type { AgentCommand, CommandBusDeps, CommandExecutor, CommandType } from '../commands/commandBus'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeCommand = (overrides: Partial<AgentCommand> = {}): AgentCommand => ({
  id: 'cmd-001',
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

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<CommandBusDeps> = {}): CommandBusDeps {
  const db: CommandBusDeps['db'] = {
    insertCommand: vi.fn().mockImplementation(async (cmd) => ({
      id: 'cmd-generated-id',
      createdAt: new Date().toISOString(),
      ...cmd,
    })),
    claimPendingCommands: vi.fn().mockResolvedValue([]),
    completeCommand: vi.fn().mockResolvedValue(undefined),
    failCommand: vi.fn().mockResolvedValue(undefined),
    deadLetterCommand: vi.fn().mockResolvedValue(undefined),
  }

  const mockExecutor: CommandExecutor = {
    execute: vi.fn().mockResolvedValue({ success: true }),
  }

  const executors: CommandBusDeps['executors'] = {
    SendEmail: mockExecutor,
  }

  return {
    db: { ...db, ...(overrides.db ?? {}) },
    executors: { ...executors, ...(overrides.executors ?? {}) },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// issue() tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CommandBus.issue()', () => {
  it('inserts a command with status=pending, attempts=0, maxAttempts=3 by default', async () => {
    const deps = makeDeps()
    const bus = new CommandBus(deps)

    await bus.issue('SendEmail', { recipientEmail: 'dan@example.com' }, {
      gymId: 'gym-001',
      issuedByAgent: 'retention',
    })

    expect(deps.db.insertCommand).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'SendEmail',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      gymId: 'gym-001',
      issuedByAgent: 'retention',
      payload: { recipientEmail: 'dan@example.com' },
    }))
  })

  it('returns the command ID from insertCommand', async () => {
    const deps = makeDeps()
    const bus = new CommandBus(deps)

    const id = await bus.issue('SendSMS', {}, {
      gymId: 'gym-001',
      issuedByAgent: 'retention',
    })

    expect(id).toBe('cmd-generated-id')
  })

  it('accepts custom maxAttempts', async () => {
    const deps = makeDeps()
    const bus = new CommandBus(deps)

    await bus.issue('CreateTask', {}, {
      gymId: 'gym-001',
      issuedByAgent: 'retention',
      maxAttempts: 5,
    })

    expect(deps.db.insertCommand).toHaveBeenCalledWith(expect.objectContaining({
      maxAttempts: 5,
    }))
  })

  it('includes taskId when provided', async () => {
    const deps = makeDeps()
    const bus = new CommandBus(deps)

    await bus.issue('SendEmail', {}, {
      gymId: 'gym-001',
      issuedByAgent: 'retention',
      taskId: 'task-abc',
    })

    expect(deps.db.insertCommand).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-abc',
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// processNext() — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('CommandBus.processNext() — success path', () => {
  it('claims pending commands and calls executor', async () => {
    const cmd = makeCommand()
    const mockExecutor: CommandExecutor = {
      execute: vi.fn().mockResolvedValue({ emailId: 'email-123' }),
    }
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn().mockResolvedValue(undefined),
        failCommand: vi.fn(),
        deadLetterCommand: vi.fn(),
      },
      executors: { SendEmail: mockExecutor },
    })

    const bus = new CommandBus(deps)
    const result = await bus.processNext(10)

    expect(deps.db.claimPendingCommands).toHaveBeenCalledWith(10)
    expect(mockExecutor.execute).toHaveBeenCalledWith(cmd)
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('marks command succeeded after successful execution', async () => {
    const cmd = makeCommand()
    const executorResult = { emailId: 'email-123', providerId: 'resend-001' }
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn().mockResolvedValue(undefined),
        failCommand: vi.fn(),
        deadLetterCommand: vi.fn(),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockResolvedValue(executorResult) },
      },
    })

    const bus = new CommandBus(deps)
    await bus.processNext()

    expect(deps.db.completeCommand).toHaveBeenCalledWith('cmd-001', executorResult)
    expect(deps.db.failCommand).not.toHaveBeenCalled()
  })

  it('returns { processed: 0, failed: 0 } when no commands pending', async () => {
    const deps = makeDeps()
    const bus = new CommandBus(deps)

    const result = await bus.processNext()

    expect(result.processed).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('processes multiple commands in one call', async () => {
    const cmds = [makeCommand({ id: 'cmd-1' }), makeCommand({ id: 'cmd-2' })]
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue(cmds),
        completeCommand: vi.fn().mockResolvedValue(undefined),
        failCommand: vi.fn(),
        deadLetterCommand: vi.fn(),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockResolvedValue({ success: true }) },
      },
    })

    const bus = new CommandBus(deps)
    const result = await bus.processNext(5)

    expect(result.processed).toBe(2)
    expect(result.failed).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// processNext() — failure and retry paths
// ─────────────────────────────────────────────────────────────────────────────

describe('CommandBus.processNext() — failure and retry', () => {
  it('marks command failed and sets nextAttemptAt with backoff on executor throw', async () => {
    const cmd = makeCommand({ attempts: 0, maxAttempts: 3 })
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn(),
        failCommand: vi.fn().mockResolvedValue(undefined),
        deadLetterCommand: vi.fn(),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockRejectedValue(new Error('SMTP error')) },
      },
    })

    const before = Date.now()
    const bus = new CommandBus(deps)
    const result = await bus.processNext()

    expect(result.failed).toBe(1)
    expect(result.processed).toBe(0)

    // failCommand should have been called
    expect(deps.db.failCommand).toHaveBeenCalledWith(
      'cmd-001',
      expect.stringContaining('SMTP error'),
      expect.any(Date),
    )

    // nextAttemptAt should be ~2 minutes in the future (attempt 0 → backoff is 2min)
    const [, , nextAttemptAt] = (deps.db.failCommand as any).mock.calls[0]
    const diffMs = nextAttemptAt.getTime() - before
    expect(diffMs).toBeGreaterThan(1 * 60 * 1000)  // > 1 min
    expect(diffMs).toBeLessThan(5 * 60 * 1000)     // < 5 min
  })

  it('dead-letters when attempts >= maxAttempts', async () => {
    // attempts = 2, maxAttempts = 3 → this is the 3rd attempt (0-indexed) → dead-letter
    const cmd = makeCommand({ attempts: 2, maxAttempts: 3 })
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn(),
        failCommand: vi.fn(),
        deadLetterCommand: vi.fn().mockResolvedValue(undefined),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockRejectedValue(new Error('still failing')) },
      },
    })

    const bus = new CommandBus(deps)
    const result = await bus.processNext()

    expect(deps.db.deadLetterCommand).toHaveBeenCalledWith(
      'cmd-001',
      expect.stringContaining('still failing'),
    )
    expect(deps.db.failCommand).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })

  it('dead-letters immediately for unknown command type (no executor)', async () => {
    const cmd = makeCommand({ commandType: 'CloseTask' }) // no executor for CloseTask
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn(),
        failCommand: vi.fn(),
        deadLetterCommand: vi.fn().mockResolvedValue(undefined),
      },
      executors: {
        // Only SendEmail registered — CloseTask has no executor
        SendEmail: { execute: vi.fn() },
      },
    })

    const bus = new CommandBus(deps)
    const result = await bus.processNext()

    expect(deps.db.deadLetterCommand).toHaveBeenCalledWith(
      'cmd-001',
      expect.stringContaining('CloseTask'),
    )
    expect(result.failed).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Exponential backoff
// ─────────────────────────────────────────────────────────────────────────────

describe('CommandBus exponential backoff', () => {
  it('attempt 1 (attempts=0) → nextAttemptAt ≈ +2min', async () => {
    const cmd = makeCommand({ attempts: 0, maxAttempts: 3 })
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn(),
        failCommand: vi.fn().mockResolvedValue(undefined),
        deadLetterCommand: vi.fn(),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockRejectedValue(new Error('fail')) },
      },
    })

    const before = Date.now()
    const bus = new CommandBus(deps)
    await bus.processNext()

    const [, , nextAttemptAt] = (deps.db.failCommand as any).mock.calls[0]
    const diffMin = (nextAttemptAt.getTime() - before) / 60000
    expect(diffMin).toBeGreaterThanOrEqual(1.5)
    expect(diffMin).toBeLessThan(3.5)
  })

  it('attempt 2 (attempts=1) → nextAttemptAt ≈ +10min', async () => {
    const cmd = makeCommand({ attempts: 1, maxAttempts: 3 })
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn(),
        failCommand: vi.fn().mockResolvedValue(undefined),
        deadLetterCommand: vi.fn(),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockRejectedValue(new Error('fail')) },
      },
    })

    const before = Date.now()
    const bus = new CommandBus(deps)
    await bus.processNext()

    const [, , nextAttemptAt] = (deps.db.failCommand as any).mock.calls[0]
    const diffMin = (nextAttemptAt.getTime() - before) / 60000
    expect(diffMin).toBeGreaterThanOrEqual(8)
    expect(diffMin).toBeLessThan(13)
  })

  it('attempt 3 (attempts=2, maxAttempts=3) → dead-letters instead of scheduling retry', async () => {
    const cmd = makeCommand({ attempts: 2, maxAttempts: 3 })
    const deps = makeDeps({
      db: {
        insertCommand: vi.fn(),
        claimPendingCommands: vi.fn().mockResolvedValue([cmd]),
        completeCommand: vi.fn(),
        failCommand: vi.fn(),
        deadLetterCommand: vi.fn().mockResolvedValue(undefined),
      },
      executors: {
        SendEmail: { execute: vi.fn().mockRejectedValue(new Error('fail')) },
      },
    })

    const bus = new CommandBus(deps)
    await bus.processNext()

    expect(deps.db.deadLetterCommand).toHaveBeenCalled()
    expect(deps.db.failCommand).not.toHaveBeenCalled()
  })
})
