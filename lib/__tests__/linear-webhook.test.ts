/**
 * linear-webhook.test.ts
 *
 * Tests for POST /api/webhooks/linear — the Linear webhook that:
 * 1. Triggers auto-fix via GitHub Actions when a ticket moves to Backlog
 * 2. Handles human comments on stuck tickets → re-triggers autofix
 * 3. Enforces per-ticket budget ($2 cap)
 * 4. Distinguishes machine vs human comments via <!-- MACHINE: --> markers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Import ──────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/webhooks/linear/route'
import { countAttemptsFromAudits } from '@/app/api/webhooks/linear/route'
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

function makeCommentPayload(body: string, overrides?: Record<string, any>) {
  return {
    action: 'create',
    type: 'Comment',
    data: {
      id: 'comment-uuid-1',
      body,
      issue: {
        id: 'issue-uuid-1',
        identifier: 'AGT-10',
        title: '[bug] Something broke',
        description: 'It broke when I clicked the thing',
        url: 'https://linear.app/pushpress/issue/AGT-10',
      },
    },
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

/** Mock the Linear GraphQL API response for fetchIssueContext. */
function mockLinearGraphQL(overrides?: {
  stateName?: string
  stateType?: string
  labels?: string[]
  commentBodies?: string[]
}) {
  const defaults = {
    stateName: 'Stuck',
    stateType: 'started',
    labels: ['needs-investigation', 'stuck'],
    commentBodies: [] as string[],
  }
  const config = { ...defaults, ...overrides }

  mockFetch.mockImplementation((url: string) => {
    if (url === 'https://api.linear.app/graphql') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            issue: {
              identifier: 'AGT-10',
              title: '[bug] Something broke',
              description: 'It broke when I clicked the thing',
              url: 'https://linear.app/pushpress/issue/AGT-10',
              state: { name: config.stateName, type: config.stateType },
              labels: { nodes: config.labels.map(name => ({ name })) },
              comments: { nodes: config.commentBodies.map(body => ({ body, createdAt: new Date().toISOString() })) },
            },
          },
        }),
      })
    }
    // GitHub dispatch
    return Promise.resolve({ ok: true })
  })
}

// ── Tests: Issue update (Backlog transition) ────────────────────────────────

describe('POST /api/webhooks/linear — Issue updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(dispatchBody.client_payload.attempt).toBe(1)
    expect(dispatchBody.client_payload.automerge).toBe(true)
    expect(dispatchBody.client_payload.risk_level).toBe('safe')
    expect(dispatchBody.client_payload.budget_remaining_cents).toBe(200)
  })

  it('skips non-Issue events', async () => {
    const res = await POST(makeReq(makePayload({ type: 'Comment', action: 'update' })))
    const body = await res.json()

    expect(body.skipped).toBe('unhandled event type')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips non-update actions for Issues', async () => {
    const res = await POST(makeReq(makePayload({ action: 'create' })))
    const body = await res.json()

    expect(body.skipped).toBe('unhandled event type')
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

// ── Tests: Comment handling (stuck ticket retry) ────────────────────────────

describe('POST /api/webhooks/linear — Comment handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LINEAR_WEBHOOK_SECRET
    process.env.GITHUB_TOKEN = 'ghp_test_token'
    process.env.GITHUB_REPO = 'duyemura/gymagents'
    process.env.LINEAR_API_KEY = 'lin_test_key'
  })

  it('re-triggers autofix when human comments on stuck ticket', async () => {
    mockLinearGraphQL()

    const payload = makeCommentPayload('I think the issue is in the auth middleware.')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(true)
    expect(body.identifier).toBe('AGT-10')
    expect(body.attempt).toBe(1) // no previous audits

    // Should have called Linear API + GitHub dispatch
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Second call should be GitHub dispatch
    const [url, opts] = mockFetch.mock.calls[1]
    expect(url).toBe('https://api.github.com/repos/duyemura/gymagents/dispatches')
    const dispatchBody = JSON.parse(opts.body)
    expect(dispatchBody.client_payload.attempt).toBe(1)
  })

  it('skips machine-generated comments', async () => {
    const payload = makeCommentPayload('<!-- MACHINE:audit -->\n## Autofix Run #1\nResult: No PR')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('machine comment')
    // Should not call any APIs
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips comments on non-stuck tickets', async () => {
    mockLinearGraphQL({ stateName: 'In Progress', stateType: 'started', labels: ['needs-investigation'] })

    const payload = makeCommentPayload('Just a regular comment')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('issue not in stuck state')
  })

  it('skips comments on tickets without needs-investigation label', async () => {
    mockLinearGraphQL({ labels: ['bug', 'stuck'] })

    const payload = makeCommentPayload('Trying to help')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('no needs-investigation label')
  })

  it('enforces budget cap — rejects when budget exceeded', async () => {
    // 4 previous audit comments = $2.00 spent
    const auditBodies = [
      '<!-- MACHINE:audit -->\n## Autofix Run #1',
      '<!-- MACHINE:audit -->\n## Autofix Run #2',
      '<!-- MACHINE:audit -->\n## Autofix Run #3',
      '<!-- MACHINE:audit -->\n## Autofix Run #4',
    ]

    mockLinearGraphQL({ commentBodies: auditBodies })

    const payload = makeCommentPayload('Try again please')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('budget exceeded')
    expect(body.spent_cents).toBe(200)
  })

  it('calculates remaining budget correctly with previous attempts', async () => {
    // 2 previous audit comments = $1.00 spent, $1.00 remaining
    const auditBodies = [
      '<!-- MACHINE:audit -->\n## Autofix Run #1',
      '<!-- MACHINE:audit -->\n## Autofix Run #2',
    ]

    mockLinearGraphQL({ commentBodies: auditBodies })

    const payload = makeCommentPayload('The error is in line 42')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.triggered).toBe(true)
    expect(body.attempt).toBe(3) // 2 previous + 1
    expect(body.budget_remaining_cents).toBe(100) // $2.00 - $1.00

    // Check the dispatch payload has correct budget
    const dispatchCall = mockFetch.mock.calls.find(
      ([url]: [string]) => url.includes('github.com')
    )
    const dispatchBody = JSON.parse(dispatchCall[1].body)
    expect(dispatchBody.client_payload.budget_remaining_cents).toBe(100)
    expect(dispatchBody.client_payload.attempt).toBe(3)
  })

  it('handles missing LINEAR_API_KEY for comment events', async () => {
    delete process.env.LINEAR_API_KEY

    const payload = makeCommentPayload('A human comment')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    expect(body.skipped).toBe('could not fetch issue context')
  })
})

// ── Tests: Machine marker detection ─────────────────────────────────────────

describe('Machine marker detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LINEAR_WEBHOOK_SECRET
    process.env.GITHUB_TOKEN = 'ghp_test_token'
    process.env.GITHUB_REPO = 'duyemura/gymagents'
    process.env.LINEAR_API_KEY = 'lin_test_key'
  })

  it('detects MACHINE:investigation markers', async () => {
    const payload = makeCommentPayload('<!-- MACHINE:investigation -->\n## AI Investigation\nStuff')
    const res = await POST(makeReq(payload))
    const body = await res.json()
    expect(body.skipped).toBe('machine comment')
  })

  it('detects MACHINE:audit markers', async () => {
    const payload = makeCommentPayload('<!-- MACHINE:audit -->\n## Autofix Run #1')
    const res = await POST(makeReq(payload))
    const body = await res.json()
    expect(body.skipped).toBe('machine comment')
  })

  it('detects MACHINE:question markers', async () => {
    const payload = makeCommentPayload('<!-- MACHINE:question -->\n## Question\nWhat is X?')
    const res = await POST(makeReq(payload))
    const body = await res.json()
    expect(body.skipped).toBe('machine comment')
  })

  it('treats comments without markers as human', async () => {
    mockLinearGraphQL()

    const payload = makeCommentPayload('I think the issue is in the auth module')
    const res = await POST(makeReq(payload))
    const body = await res.json()

    // Should not be skipped as machine comment — should process as human
    expect(body.skipped).not.toBe('machine comment')
    expect(body.triggered).toBe(true)
  })
})

// ── Tests: countAttemptsFromAudits ──────────────────────────────────────────

describe('countAttemptsFromAudits', () => {
  it('counts zero attempts for empty array', () => {
    const result = countAttemptsFromAudits([])
    expect(result.attempts).toBe(0)
    expect(result.estimatedCostCents).toBe(0)
  })

  it('counts attempts and calculates cost', () => {
    const audits = [
      '<!-- MACHINE:audit -->\n## Run 1',
      '<!-- MACHINE:audit -->\n## Run 2',
      '<!-- MACHINE:audit -->\n## Run 3',
    ]
    const result = countAttemptsFromAudits(audits)
    expect(result.attempts).toBe(3)
    expect(result.estimatedCostCents).toBe(150) // 3 * $0.50
  })

  it('calculates budget exceeded at 4 attempts', () => {
    const audits = Array(4).fill('<!-- MACHINE:audit -->')
    const result = countAttemptsFromAudits(audits)
    expect(result.attempts).toBe(4)
    expect(result.estimatedCostCents).toBe(200) // exactly $2.00
  })
})
