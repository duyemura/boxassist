/**
 * Tests for app/api/conversations/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockSessionRef,
  mockAccountRef,
  mockGetConversations,
} = vi.hoisted(() => ({
  mockSessionRef: { current: null as any },
  mockAccountRef: { current: null as any },
  mockGetConversations: vi.fn().mockResolvedValue([]),
}))

// ── Mock auth ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockSessionRef.current),
}))

// ── Mock db/accounts ──────────────────────────────────────────────────────────

vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: vi.fn(() => mockAccountRef.current),
}))

// ── Mock db/conversations ─────────────────────────────────────────────────────

vi.mock('@/lib/db/conversations', () => ({
  getConversations: mockGetConversations,
}))

// ── Import route handler ──────────────────────────────────────────────────────

import { GET } from '../../app/api/conversations/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/conversations')
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  return new NextRequest(url, { method: 'GET' })
}

const DEFAULT_ACCOUNT = { id: 'acct-1', name: 'Test Business' }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionRef.current = null
    mockAccountRef.current = null
  })

  it('returns 401 when not authenticated', async () => {
    mockSessionRef.current = null

    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns empty array when no account found', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = null

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conversations).toEqual([])
  })

  it('returns conversations for the account', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT

    const conversations = [
      { id: 'conv-1', accountId: 'acct-1', contactName: 'Alex', status: 'open', assignedRole: 'front_desk' },
      { id: 'conv-2', accountId: 'acct-1', contactName: 'Sam', status: 'escalated', assignedRole: 'gm' },
    ]
    mockGetConversations.mockResolvedValueOnce(conversations)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conversations).toHaveLength(2)
    expect(body.conversations[0].contactName).toBe('Alex')
  })

  it('filters by status query param', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockResolvedValueOnce([])

    await GET(makeRequest({ status: 'escalated' }))

    expect(mockGetConversations).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ status: 'escalated' }),
    )
  })

  it('filters by role query param', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockResolvedValueOnce([])

    await GET(makeRequest({ role: 'gm' }))

    expect(mockGetConversations).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ assignedRole: 'gm' }),
    )
  })

  it('respects limit query param (capped at 100)', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockResolvedValueOnce([])

    await GET(makeRequest({ limit: '200' }))

    expect(mockGetConversations).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ limit: 100 }),
    )
  })

  it('defaults limit to 50', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockResolvedValueOnce([])

    await GET(makeRequest())

    expect(mockGetConversations).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ limit: 50 }),
    )
  })

  it('returns 400 for invalid status', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT

    const res = await GET(makeRequest({ status: 'invalid_status' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid status')
  })

  it('returns 500 when getConversations throws', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockRejectedValueOnce(new Error('DB error'))

    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('Failed to fetch conversations')
  })

  it('passes no status filter when not provided', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockResolvedValueOnce([])

    await GET(makeRequest())

    expect(mockGetConversations).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ status: undefined }),
    )
  })

  it('passes no role filter when not provided', async () => {
    mockSessionRef.current = { id: 'user-1', email: 'test@example.com' }
    mockAccountRef.current = DEFAULT_ACCOUNT
    mockGetConversations.mockResolvedValueOnce([])

    await GET(makeRequest())

    expect(mockGetConversations).toHaveBeenCalledWith(
      'acct-1',
      expect.objectContaining({ assignedRole: undefined }),
    )
  })
})
