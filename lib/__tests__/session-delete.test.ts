/**
 * session-delete.test.ts
 *
 * Tests for DELETE /api/agents/runs/[sessionId]
 * Validates: auth, account scoping, successful deletion, not-found handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockGetSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: vi.fn().mockResolvedValue({ id: 'acct-001' }),
}))

const mockDelete = vi.fn()
const mockSelectSingle = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSelectSingle,
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: mockDelete,
        }),
      }),
    })),
  },
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { DELETE } from '@/app/api/agents/runs/[sessionId]/route'
import { NextRequest } from 'next/server'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq() {
  return new NextRequest('http://localhost:3000/api/agents/runs/sess-1', {
    method: 'DELETE',
  })
}

const params = { params: { sessionId: 'sess-1' } }

// ── Tests ───────────────────────────────────────────────────────────────

describe('DELETE /api/agents/runs/[sessionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when session does not exist or belongs to different account', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockSelectSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } })

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(404)
  })

  it('deletes session and returns success', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockSelectSingle.mockResolvedValue({
      data: { id: 'sess-1', account_id: 'acct-001' },
      error: null,
    })
    mockDelete.mockResolvedValue({ error: null })

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 500 on database error during delete', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1' })
    mockSelectSingle.mockResolvedValue({
      data: { id: 'sess-1', account_id: 'acct-001' },
      error: null,
    })
    mockDelete.mockResolvedValue({ error: { message: 'FK constraint' } })

    const res = await DELETE(makeReq(), params)
    expect(res.status).toBe(500)
  })
})
