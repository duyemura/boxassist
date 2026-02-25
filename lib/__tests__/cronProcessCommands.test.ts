/**
 * cronProcessCommands.test.ts
 *
 * TDD tests for the process-commands Vercel Cron endpoint.
 *
 * Covers:
 *   - Valid CRON_SECRET → processes commands and returns { processed, failed }
 *   - Invalid/missing CRON_SECRET → returns 401
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mock CommandBus ───────────────────────────────────────────────────────────

const { mockProcessNext } = vi.hoisted(() => ({
  mockProcessNext: vi.fn().mockResolvedValue({ processed: 5, failed: 1 }),
}))

vi.mock('../commands/commandBus', () => {
  return {
    CommandBus: class MockCommandBus {
      processNext = mockProcessNext
    },
  }
})

// ── Mock Resend (imported at module level in process-commands route) ──────────
vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: vi.fn().mockResolvedValue({ id: 'mock-email-id' }) }
    },
  }
})

// ── Mock db/tasks (used by autopilot + follow-up sections) ───────────────────
vi.mock('../db/tasks', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  appendConversation: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock sendEmail from lib/resend ───────────────────────────────────────────
vi.mock('../resend', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email-id', error: null }),
}))

// ── Mock SendEmailExecutor ───────────────────────────────────────────────────
vi.mock('../commands/executors/sendEmailExecutor', () => ({
  SendEmailExecutor: class MockSendEmailExecutor {},
}))

// ── Mock db/commands (real deps injected into CommandBus) ─────────────────────
vi.mock('../db/commands', () => ({
  insertCommand: vi.fn(),
  claimPendingCommands: vi.fn().mockResolvedValue([]),
  completeCommand: vi.fn(),
  failCommand: vi.fn(),
  deadLetterCommand: vi.fn(),
  createOutboundMessage: vi.fn(),
  updateOutboundMessageStatus: vi.fn(),
}))

// ── Import the route handler ──────────────────────────────────────────────────
import { POST } from '../../app/api/cron/process-commands/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (secret !== undefined) {
    headers['authorization'] = `Bearer ${secret}`
  }
  return new NextRequest('http://localhost/api/cron/process-commands', {
    method: 'POST',
    headers,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/cron/process-commands', () => {
  beforeEach(() => {
    mockProcessNext.mockReset()
    mockProcessNext.mockResolvedValue({ processed: 5, failed: 1 })
  })

  it('returns 401 when no authorization header provided', async () => {
    const req = makeRequest(undefined)
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret provided', async () => {
    const req = makeRequest('wrong-secret')
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('processes commands and returns result with valid secret', async () => {
    const req = makeRequest('test-cron-secret') // set in setup.ts: CRON_SECRET=test-cron-secret

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ processed: 5, failed: 1 })
    expect(mockProcessNext).toHaveBeenCalledWith(20)
  })

  it('calls processNext with limit=20', async () => {
    const req = makeRequest('test-cron-secret')

    await POST(req)

    expect(mockProcessNext).toHaveBeenCalledWith(20)
  })
})
