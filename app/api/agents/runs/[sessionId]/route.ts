export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/runs/[sessionId]
 * Load a session's metadata + reconstruct its message history for display.
 * Messages are stored as raw Claude API format; we convert to ChatMessage[].
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { supabaseAdmin } from '@/lib/supabase'

// ── Message reconstruction ────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system'
  content: string
  timestamp: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolUseId?: string
}

/**
 * Convert stored Claude API messages (JSONB) → display ChatMessage[].
 * Individual messages don't have their own timestamps — we distribute them
 * linearly between session created_at and updated_at.
 */
function reconstructMessages(
  claudeMessages: any[],
  sessionCreatedAt: string,
  sessionUpdatedAt: string,
): ChatMessage[] {
  const result: ChatMessage[] = []
  const startMs = new Date(sessionCreatedAt).getTime()
  const endMs = new Date(sessionUpdatedAt).getTime()
  const total = claudeMessages.length || 1

  let idx = 0

  for (const msg of claudeMessages) {
    const ts = new Date(startMs + ((endMs - startMs) * idx) / total).toISOString()

    if (msg.role === 'user') {
      if (typeof msg.content === 'string' && msg.content) {
        result.push({ id: `u-${idx}`, role: 'user', content: msg.content, timestamp: ts })
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            result.push({ id: `u-${idx}-t`, role: 'user', content: block.text, timestamp: ts })
          } else if (block.type === 'tool_result') {
            result.push({
              id: `tr-${idx}-${block.tool_use_id}`,
              role: 'tool_result',
              content: '',
              toolUseId: block.tool_use_id,
              toolResult: block.content,
              timestamp: ts,
            })
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            result.push({ id: `a-${idx}-t`, role: 'assistant', content: block.text, timestamp: ts })
          } else if (block.type === 'tool_use') {
            result.push({
              id: `tc-${idx}-${block.id}`,
              role: 'tool_call',
              content: '',
              toolName: block.name,
              toolInput: block.input,
              toolUseId: block.id,
              timestamp: ts,
            })
          }
        }
      } else if (typeof msg.content === 'string' && msg.content) {
        result.push({ id: `a-${idx}`, role: 'assistant', content: msg.content, timestamp: ts })
      }
    }

    idx++
  }

  return result
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser((session as any).id)
  if (!account) return NextResponse.json({ error: 'No account' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('agent_sessions')
    .select('id, goal, status, turn_count, cost_cents, messages, created_at, updated_at')
    .eq('id', params.sessionId)
    .eq('account_id', account.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = reconstructMessages(
    data.messages ?? [],
    data.created_at,
    data.updated_at,
  )

  return NextResponse.json({
    session: {
      id: data.id,
      goal: data.goal,
      status: data.status,
      turn_count: data.turn_count,
      cost_cents: data.cost_cents,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
    messages,
  })
}
