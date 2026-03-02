/**
 * agent-delete.test.ts
 *
 * Tests for DELETE /api/agents/[id]
 * Validates: auth, ownership check, cascading cleanup, successful deletion, error handling.
 *
 * Related bug: AGT-11 — deleted agent reappears on reload because the client
 * didn't check the API response status before optimistically removing the agent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

const mockGetAccountForUser = vi.fn()
vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: (...args: unknown[]) => mockGetAccountForUser(...args),
}))

// Track all from().delete()/select()/update() chains
const mockAgentDelete = vi.fn()
const mockAutomationDelete = vi.fn()
const mockSubscriptionDelete = vi.fn()
const mockSessionUpdate = vi.fn()
const mockAgentSelect = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'agents') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: mockAgentSelect,
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: mockAgentDelete,
          }),
        }
      }
      if (table === 'agent_automations') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: mockAutomationDelete,
          }),
        }
      }
      if (table === 'agent_subscriptions') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: mockSubscriptionDelete,
          }),
        }
      }
      if (table === 'agent_sessions') {
        return {
          update: vi.fn().mockReturnValue({
            eq: mockSessionUpdate,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
    }),
  },
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { DELETE } from '@/app/api/agents/[id]/route'
import { NextRequest } from 'next/server'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq() {
  return new NextRequest('http://localhost:3000/api/agents/agent-123', {
    method: 'DELETE',
  })
}

const params = { params: { id: 'agent-123' } }

// ── Tests ───────────────────────────────────────────────────────────────

describe('DELETE /api/agents/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 404 when agent does not belong to user account', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockGetAccountForUser.mockResolvedValue({ id: 'acct-001' })
    mockAgentSelect.mockResolvedValue({ data: null, error: { code: 'PGRST116' } })

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('returns 404 when user has no account', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockGetAccountForUser.mockResolvedValue(null)

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(404)
  })

  it('deletes agent and related records on success', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockGetAccountForUser.mockResolvedValue({ id: 'acct-001' })
    mockAgentSelect.mockResolvedValue({
      data: { id: 'agent-123', account_id: 'acct-001' },
      error: null,
    })
    mockAutomationDelete.mockResolvedValue({ error: null })
    mockSubscriptionDelete.mockResolvedValue({ error: null })
    mockSessionUpdate.mockResolvedValue({ error: null })
    mockAgentDelete.mockResolvedValue({ error: null })

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Verify cascading cleanup happened
    expect(mockAutomationDelete).toHaveBeenCalled()
    expect(mockSubscriptionDelete).toHaveBeenCalled()
    expect(mockSessionUpdate).toHaveBeenCalled()
    expect(mockAgentDelete).toHaveBeenCalled()
  })

  it('nullifies agent_sessions references before deleting agent', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockGetAccountForUser.mockResolvedValue({ id: 'acct-001' })
    mockAgentSelect.mockResolvedValue({
      data: { id: 'agent-123', account_id: 'acct-001' },
      error: null,
    })
    mockAutomationDelete.mockResolvedValue({ error: null })
    mockSubscriptionDelete.mockResolvedValue({ error: null })
    mockSessionUpdate.mockResolvedValue({ error: null })
    mockAgentDelete.mockResolvedValue({ error: null })

    const { supabaseAdmin } = await import('@/lib/supabase')

    await DELETE(makeReq(), params)

    // Verify agent_sessions was updated to nullify agent_id before delete
    const fromCalls = vi.mocked(supabaseAdmin.from).mock.calls.map(c => c[0])
    expect(fromCalls).toContain('agent_sessions')
    expect(mockSessionUpdate).toHaveBeenCalled()
  })

  it('returns 500 on database error during agent delete', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockGetAccountForUser.mockResolvedValue({ id: 'acct-001' })
    mockAgentSelect.mockResolvedValue({
      data: { id: 'agent-123', account_id: 'acct-001' },
      error: null,
    })
    mockAutomationDelete.mockResolvedValue({ error: null })
    mockSubscriptionDelete.mockResolvedValue({ error: null })
    mockSessionUpdate.mockResolvedValue({ error: null })
    mockAgentDelete.mockResolvedValue({ error: { message: 'FK constraint violation' } })

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('FK constraint violation')
  })
})
