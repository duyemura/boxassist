/**
 * /api/agents/chat — SSE-based chat endpoint for interactive agent sessions.
 *
 * POST body variants:
 *   { action: 'start', goal, agentId?, tools?, mode? }
 *   { action: 'message', sessionId, content }
 *   { action: 'approve', sessionId, approvals: Record<string, boolean> }
 *   { action: 'set_mode', sessionId, mode }
 *
 * GET ?sessionId=xxx — returns current session state (for reconnection)
 *
 * Streams SessionEvent objects as SSE events.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import {
  startSession,
  resumeSession,
  loadSession,
} from '@/lib/agents/session-runtime'
import type { AutonomyMode } from '@/lib/agents/tools/types'

// ── GET: session state for reconnection ─────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const agentSession = await loadSession(sessionId)
  if (!agentSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Verify account access
  const { user, account } = await getUserAndAccount(session.id)
  if (!account || agentSession.accountId !== account.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    sessionId: agentSession.id,
    status: agentSession.status,
    autonomyMode: agentSession.autonomyMode,
    turnCount: agentSession.turnCount,
    costCents: agentSession.costCents,
    pendingApprovals: agentSession.pendingApprovals,
    outputs: agentSession.outputs,
    goal: agentSession.goal,
    createdAt: agentSession.createdAt,
  })
}

// ── POST: start, message, approve, set_mode ─────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const action = body.action as string
  if (!action || !['start', 'message', 'approve', 'set_mode'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Auth: load user + account
  const { user, account } = await getUserAndAccount(session.id)
  if (!account) {
    return new Response(JSON.stringify({ error: 'No account found' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Decrypt API key
  const rawKey = account.pushpress_api_key
  const companyId = account.pushpress_company_id ?? ''

  if (!rawKey) {
    return new Response(JSON.stringify({ error: 'PushPress API key not configured' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let apiKey: string
  try {
    apiKey = decrypt(rawKey)
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to decrypt API key' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Stream SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* stream closed */ }
      }

      try {
        if (action === 'start') {
          const goal = body.goal as string
          if (!goal) {
            send({ type: 'error', message: 'goal is required' })
            controller.close()
            return
          }

          // Load agent config if agentId provided
          let systemPromptOverride: string | null = null
          let skillType: string | undefined
          if (body.agentId) {
            const { data: agent } = await supabaseAdmin
              .from('agents')
              .select('system_prompt, skill_type')
              .eq('id', body.agentId as string)
              .single()
            if (agent) {
              systemPromptOverride = (agent as any).system_prompt
              skillType = (agent as any).skill_type
            }
          }

          for await (const event of startSession({
            accountId: account.id,
            goal,
            agentId: body.agentId as string | undefined,
            tools: (body.tools as string[]) ?? ['data', 'action', 'learning'],
            autonomyMode: (body.mode as AutonomyMode) ?? 'semi_auto',
            apiKey,
            companyId,
            systemPromptOverride,
            skillType,
          })) {
            send(event)
          }
        } else if (action === 'message') {
          const sessionId = body.sessionId as string
          const content = body.content as string
          if (!sessionId) {
            send({ type: 'error', message: 'sessionId is required' })
            controller.close()
            return
          }

          for await (const event of resumeSession(sessionId, {
            message: content || '',
          })) {
            send(event)
          }
        } else if (action === 'approve') {
          const sessionId = body.sessionId as string
          const approvals = body.approvals as Record<string, boolean>
          if (!sessionId || !approvals) {
            send({ type: 'error', message: 'sessionId and approvals are required' })
            controller.close()
            return
          }

          for await (const event of resumeSession(sessionId, { approvals })) {
            send(event)
          }
        } else if (action === 'set_mode') {
          const sessionId = body.sessionId as string
          const mode = body.mode as AutonomyMode
          if (!sessionId || !mode) {
            send({ type: 'error', message: 'sessionId and mode are required' })
            controller.close()
            return
          }

          for await (const event of resumeSession(sessionId, {
            newMode: mode,
            message: `[System] Autonomy mode changed to ${mode}.`,
          })) {
            send(event)
          }
        }
      } catch (err: any) {
        send({ type: 'error', message: err.message ?? 'Internal server error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function getUserAndAccount(userId: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  const { getAccountForUser } = await import('@/lib/db/accounts')
  const account = await getAccountForUser(userId)

  return { user, account }
}
