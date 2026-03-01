export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/linear
 *
 * Receives Linear webhook events. When a ticket's AI investigation
 * completes (state moves to Backlog), triggers a GitHub Actions
 * workflow to auto-fix the issue using Claude Code.
 *
 * Linear webhook setup:
 *   URL: https://app-orcin-one-70.vercel.app/api/webhooks/linear
 *   Events: Issue state changes
 *   Secret: LINEAR_WEBHOOK_SECRET env var
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ── Signature verification ───────────────────────────────────────────────────

function verifyLinearSignature(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  const expected = hmac.digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// ── Webhook handler ──────────────────────────────────────────────────────────

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
  }
  updatedFrom?: {
    stateId?: string
    updatedAt?: string
  }
}

/** Check if this issue has the needs-investigation label. */
function hasLabel(payload: LinearWebhookPayload, labelName: string): boolean {
  return payload.data.labels?.some(l => l.name === labelName) ?? false
}

/** Trigger a GitHub Actions workflow via repository_dispatch. */
async function triggerAutofix(issue: {
  id: string
  identifier: string
  title: string
  description: string
  url: string
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
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[linear-webhook] GitHub dispatch failed: ${res.status} ${text}`)
    return false
  }

  console.log(`[linear-webhook] Triggered autofix for ${issue.identifier}`)
  return true
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

  // Only process Issue updates
  if (payload.type !== 'Issue' || payload.action !== 'update') {
    return NextResponse.json({ ok: true, skipped: 'not an issue update' })
  }

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
