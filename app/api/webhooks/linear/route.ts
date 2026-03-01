export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/linear
 *
 * Receives Linear webhook events for the autonomous CI pipeline.
 *
 * Handles:
 * 1. Issue state → Backlog: triggers autofix via GitHub Actions
 * 2. Comment.create on stuck ticket: human comment triggers re-investigation + retry
 * 3. Budget enforcement: $2 per-ticket cap based on audit comment cost tracking
 *
 * Linear webhook setup:
 *   URL: https://app-orcin-one-70.vercel.app/api/webhooks/linear
 *   Events: Issue state changes, Comment creates
 *   Secret: LINEAR_WEBHOOK_SECRET env var
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ── Constants ────────────────────────────────────────────────────────────────

/** Per-ticket budget in cents. After this, label needs-human and stop. */
const BUDGET_LIMIT_CENTS = 200

/** Estimated cost per autofix attempt in cents (~$0.50). */
const ESTIMATED_COST_PER_ATTEMPT_CENTS = 50

// ── Signature verification ───────────────────────────────────────────────────

function verifyLinearSignature(body: string, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(body)
    const expected = hmac.digest('hex')
    if (signature.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove'
  type: 'Issue' | 'Comment' | 'IssueLabel' | 'Cycle' | 'Project'
  data: {
    id: string
    identifier?: string
    title?: string
    description?: string
    state?: { id: string; name: string; type: string }
    labels?: { id: string; name: string }[]
    url?: string
    priorityLabel?: string
    team?: { id: string; key: string }
    // Comment-specific fields
    body?: string
    issue?: { id: string; identifier: string; title: string; description?: string; url?: string }
  }
  updatedFrom?: {
    stateId?: string
    updatedAt?: string
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if this issue has a specific label. */
function hasLabel(payload: LinearWebhookPayload, labelName: string): boolean {
  return payload.data.labels?.some(l => l.name === labelName) ?? false
}

/** Check if a comment body has a MACHINE marker. */
function isMachineComment(body: string): boolean {
  return body.includes('<!-- MACHINE:')
}

/**
 * Count autofix attempts from audit comments.
 * Each <!-- MACHINE:audit --> comment = one attempt.
 * Returns the number of attempts and estimated total cost.
 */
export function countAttemptsFromAudits(auditBodies: string[]): {
  attempts: number
  estimatedCostCents: number
} {
  const attempts = auditBodies.length
  return {
    attempts,
    estimatedCostCents: attempts * ESTIMATED_COST_PER_ATTEMPT_CENTS,
  }
}

/** Trigger a GitHub Actions workflow via repository_dispatch. */
async function triggerAutofix(issue: {
  id: string
  identifier: string
  title: string
  description: string
  url: string
  attempt?: number
  riskLevel?: string
  budgetRemainingCents?: number
}): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO || 'duyemura/gymagents'

  if (!token) {
    console.error('[linear-webhook] GITHUB_TOKEN not set — cannot trigger autofix')
    return false
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'autofix',
      client_payload: {
        issue_id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: (issue.description || '').slice(0, 2000),
        url: issue.url,
        attempt: issue.attempt || 1,
        automerge: true,
        risk_level: issue.riskLevel || 'safe',
        budget_remaining_cents: issue.budgetRemainingCents ?? BUDGET_LIMIT_CENTS,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[linear-webhook] GitHub dispatch failed: ${res.status} ${text}`)
    return false
  }

  console.log(`[linear-webhook] Triggered autofix for ${issue.identifier} (attempt ${issue.attempt || 1})`)
  return true
}

// ── Comment handler: detect human input on stuck tickets ─────────────────────

/**
 * Fetch issue details via Linear API to check state and labels.
 * Used when handling Comment.create events (which don't include full issue state).
 */
async function fetchIssueContext(issueId: string): Promise<{
  identifier: string
  title: string
  description: string
  url: string
  stateName: string
  stateType: string
  labels: string[]
  commentBodies: string[]
} | null> {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) return null

  try {
    // Use Linear GraphQL API directly for a single query
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: `query($id: String!) {
          issue(id: $id) {
            identifier
            title
            description
            url
            state { name type }
            labels { nodes { name } }
            comments { nodes { body createdAt } }
          }
        }`,
        variables: { id: issueId },
      }),
    })

    if (!res.ok) return null
    const json = await res.json()
    const issue = json.data?.issue
    if (!issue) return null

    return {
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || '',
      url: issue.url,
      stateName: issue.state.name,
      stateType: issue.state.type,
      labels: issue.labels.nodes.map((l: { name: string }) => l.name),
      commentBodies: issue.comments.nodes.map((c: { body: string }) => c.body),
    }
  } catch (err) {
    console.error('[linear-webhook] Failed to fetch issue context:', err)
    return null
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handleIssueUpdate(payload: LinearWebhookPayload): Promise<Response> {
  // Only trigger when state changes TO Backlog (investigation complete)
  const newState = payload.data.state
  const wasStateChange = payload.updatedFrom?.stateId !== undefined

  if (!wasStateChange || newState?.type !== 'backlog') {
    return NextResponse.json({ ok: true, skipped: 'not a backlog transition' })
  }

  // Only auto-fix issues with needs-investigation label
  if (!hasLabel(payload, 'needs-investigation')) {
    return NextResponse.json({ ok: true, skipped: 'no needs-investigation label' })
  }

  const { id, identifier, title, description, url } = payload.data
  if (!identifier || !title || !url) {
    return NextResponse.json({ ok: true, skipped: 'missing issue data' })
  }

  console.log(`[linear-webhook] Issue ${identifier} moved to Backlog — triggering autofix`)

  const triggered = await triggerAutofix({
    id,
    identifier,
    title,
    description: description || '',
    url,
  })

  return NextResponse.json({ ok: true, triggered, identifier })
}

async function handleCommentCreate(payload: LinearWebhookPayload): Promise<Response> {
  const commentBody = payload.data.body || ''
  const issueRef = payload.data.issue

  // Skip machine-generated comments — only humans trigger retry
  if (isMachineComment(commentBody)) {
    return NextResponse.json({ ok: true, skipped: 'machine comment' })
  }

  if (!issueRef?.id) {
    return NextResponse.json({ ok: true, skipped: 'no issue reference' })
  }

  // Fetch full issue context to check state
  const ctx = await fetchIssueContext(issueRef.id)
  if (!ctx) {
    return NextResponse.json({ ok: true, skipped: 'could not fetch issue context' })
  }

  // Only re-trigger for stuck tickets with needs-investigation label
  const isStuck = ctx.stateName.toLowerCase() === 'stuck' ||
    ctx.labels.some(l => l.toLowerCase() === 'stuck')
  if (!isStuck) {
    return NextResponse.json({ ok: true, skipped: 'issue not in stuck state' })
  }

  if (!ctx.labels.includes('needs-investigation')) {
    return NextResponse.json({ ok: true, skipped: 'no needs-investigation label' })
  }

  // Budget check: count previous audit comments
  const auditBodies = ctx.commentBodies.filter(b => b.includes('<!-- MACHINE:audit'))
  const { attempts, estimatedCostCents } = countAttemptsFromAudits(auditBodies)
  const budgetRemaining = BUDGET_LIMIT_CENTS - estimatedCostCents

  if (budgetRemaining <= 0) {
    console.log(`[linear-webhook] Budget exceeded for ${ctx.identifier} ($${(estimatedCostCents / 100).toFixed(2)} spent) — needs-human`)
    return NextResponse.json({
      ok: true,
      skipped: 'budget exceeded',
      identifier: ctx.identifier,
      spent_cents: estimatedCostCents,
    })
  }

  console.log(`[linear-webhook] Human comment on stuck ${ctx.identifier} — re-triggering (attempt ${attempts + 1}, $${(budgetRemaining / 100).toFixed(2)} remaining)`)

  const triggered = await triggerAutofix({
    id: issueRef.id,
    identifier: ctx.identifier,
    title: ctx.title,
    description: ctx.description,
    url: ctx.url,
    attempt: attempts + 1,
    budgetRemainingCents: budgetRemaining,
  })

  return NextResponse.json({
    ok: true,
    triggered,
    identifier: ctx.identifier,
    attempt: attempts + 1,
    budget_remaining_cents: budgetRemaining,
  })
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // Verify signature if secret is configured
  const secret = process.env.LINEAR_WEBHOOK_SECRET
  if (secret) {
    const signature = req.headers.get('linear-signature') ?? ''
    if (!signature || !verifyLinearSignature(rawBody, signature, secret)) {
      console.warn('[linear-webhook] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let payload: LinearWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Route by event type
  if (payload.type === 'Issue' && payload.action === 'update') {
    return handleIssueUpdate(payload)
  }

  if (payload.type === 'Comment' && payload.action === 'create') {
    return handleCommentCreate(payload)
  }

  return NextResponse.json({ ok: true, skipped: 'unhandled event type' })
}
