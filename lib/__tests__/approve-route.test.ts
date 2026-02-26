/**
 * approve-route.test.ts
 *
 * Tests for POST /api/autopilot/approve.
 * Verifies:
 *   - 401 when not authenticated
 *   - 404 when task not found
 *   - 409 when task.status is 'awaiting_reply' (already sent)
 *   - 409 when task.status is 'resolved'
 *   - Happy path: approves task with status 'open'
 *   - Happy path: approves task with status 'awaiting_approval'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockSession: any = null
let mockTask: any = null
let mockUser: any = null

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockSession),
  getTier: vi.fn((user: any) => user?.tier ?? 'starter'),
}))

// Chainable Supabase mock
function makeChain(resolvedData: any) {
  const obj: any = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'not', 'or', 'in', 'gte', 'lt', 'lte',
    'single', 'maybeSingle', 'limit', 'order', 'filter',
  ]
  methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
  obj.then = (resolve: any) => resolve(resolvedData)
  return obj
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'agent_tasks') {
        return makeChain({ data: mockTask, error: null })
      }
      if (table === 'users') {
        return makeChain({ data: mockUser, error: null })
      }
      return makeChain({ data: null, error: null })
    }),
  },
}))

vi.mock('@/lib/db/tasks', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue(undefined),
  appendConversation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/gmail', () => ({
  sendGmailMessage: vi.fn().mockResolvedValue({ messageId: 'mock-gmail-id' }),
  isGmailConnected: vi.fn().mockResolvedValue(null),
}))

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: 'mock-resend-id' } }) }
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, any> = { actionId: 'task-001' }) {
  return new NextRequest('http://localhost:3000/api/autopilot/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeOpenTask(statusOverride?: string) {
  return {
    id: 'task-001',
    gym_id: 'gym-001',
    status: statusOverride ?? 'open',
    member_email: 'member@example.com',
    member_name: 'Alex Test',
    context: {
      draftMessage: 'Hey Alex, just checking in!',
      messageSubject: 'Checking in',
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/autopilot/approve', () => {
  let handler: typeof import('@/app/api/autopilot/approve/route').POST

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockSession = null
    mockTask = null
    mockUser = { id: 'user-001', tier: 'starter' }
    const mod = await import('@/app/api/autopilot/approve/route')
    handler = mod.POST
  })

  it('returns 401 when not authenticated', async () => {
    mockSession = null
    const res = await handler(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 404 when task not found', async () => {
    mockSession = { id: 'user-001' }
    mockTask = null
    const res = await handler(makeRequest())
    expect(res.status).toBe(404)
  })

  it('returns 409 when task status is awaiting_reply (already sent)', async () => {
    mockSession = { id: 'user-001' }
    mockTask = makeOpenTask('awaiting_reply')
    const res = await handler(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('Task already processed')
    expect(body.currentStatus).toBe('awaiting_reply')
  })

  it('returns 409 when task status is resolved', async () => {
    mockSession = { id: 'user-001' }
    mockTask = makeOpenTask('resolved')
    const res = await handler(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('Task already processed')
    expect(body.currentStatus).toBe('resolved')
  })

  it('returns 409 when task status is cancelled', async () => {
    mockSession = { id: 'user-001' }
    mockTask = makeOpenTask('cancelled')
    const res = await handler(makeRequest())
    expect(res.status).toBe(409)
  })

  it('succeeds when task status is open', async () => {
    mockSession = { id: 'user-001' }
    mockTask = makeOpenTask('open')
    const res = await handler(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.sent).toBe(true)
  })

  it('succeeds when task status is awaiting_approval', async () => {
    mockSession = { id: 'user-001' }
    mockTask = makeOpenTask('awaiting_approval')
    const res = await handler(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})
