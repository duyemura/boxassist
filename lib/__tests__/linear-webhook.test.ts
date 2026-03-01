/**
 * linear-webhook.test.ts
 *
 * Tests for POST /api/webhooks/linear — the Linear webhook that
 * triggers auto-fix via GitHub Actions when a ticket's investigation
 * completes and moves to Backlog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Import ──────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/webhooks/linear/route'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePayload(overrides?: Record<string, any>) {
  return {
    action: 'update',
    type: 'Issue',
    data: {
      id: 'issue-uuid-1',
      identifier: 'AGT-10',
      title: '[bug] Something broke',
      description: 'It broke when I clicked the thing',
      state: { id: 'st-backlog', name: 'Backlog', type: 'backlog' },
      labels: [{ id: 'lbl-1', name: 'needs-investigation' }],
      url: 'https://linear.app/pushpress/issue/AGT-10',
      team: { id: 'team-1', key: 'AGT' },
    },
    updatedFrom: {
      stateId: 'st-triage',
      updatedAt: '2026-02-28T10:00:00.000Z',
    } as Record<string, string>,
    ...overrides,
  }
}

function makeReq(payload: unknown, secret?: string) {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (secret) {
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(body)
    headers['linear-signature'] = hmac.digest('hex')
  }

  return new NextRequest('http://localhost:3000/api/webhooks/linear', {
    method: 'POST',
    body,
    headers,
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/linear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no webhook secret (skip verification)
    delete process.env.LINEAR_WEBHOOK_SECRET
    process.env.GITHUB_TOKEN = 'ghp_test_token'
    process.env.GITHUB_REPO = 'duyemura/gymagents'
  })

  it('triggers autofix when issue moves to Backlog with needs-investigation label', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    const res = await POST(makeReq(makePayload()))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(true)
    expect(body.identifier).toBe('AGT-10')

    // Should have called GitHub dispatch API
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/duyemura/gymagents/dispatches')
    expect(opts.method).toBe('POST')

    const dispatchBody = JSON.parse(opts.body)
    expect(dispatchBody.event_type).toBe('autofix')
    expect(dispatchBody.client_payload.identifier).toBe('AGT-10')
    expect(dispatchBody.client_payload.title).toBe('[bug] Something broke')
  })

  it('skips non-Issue events', async () => {
    const res = await POST(makeReq(makePayload({ type: 'Comment' })))
    const body = await res.json()

    expect(body.skipped).toBe('not an issue update')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips non-update actions', async () => {
    const res = await POST(makeReq(makePayload({ action: 'create' })))
    const body = await res.json()

    expect(body.skipped).toBe('not an issue update')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips when state is not Backlog', async () => {
    const payload = makePayload()
    payload.data.state = { id: 'st-progress', name: 'In Progress', type: 'started' }

    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('not a backlog transition')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips when there is no state change', async () => {
    const payload = makePayload()
    payload.updatedFrom = {}

    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('not a backlog transition')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips issues without needs-investigation label', async () => {
    const payload = makePayload()
    payload.data.labels = [{ id: 'lbl-2', name: 'bug' }]

    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('no needs-investigation label')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('verifies Linear signature when SECRET is set', async () => {
    process.env.LINEAR_WEBHOOK_SECRET = 'test-secret'
    mockFetch.mockResolvedValue({ ok: true })

    // Valid signature
    const res = await POST(makeReq(makePayload(), 'test-secret'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(true)
  })

  it('rejects invalid signature', async () => {
    process.env.LINEAR_WEBHOOK_SECRET = 'test-secret'

    // Wrong signature
    const res = await POST(makeReq(makePayload(), 'wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('handles missing GITHUB_TOKEN gracefully', async () => {
    delete process.env.GITHUB_TOKEN

    const res = await POST(makeReq(makePayload()))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('handles GitHub API failure gracefully', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => 'Forbidden' })

    const res = await POST(makeReq(makePayload()))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(false)
  })
})
