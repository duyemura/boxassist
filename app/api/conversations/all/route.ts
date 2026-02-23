import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth'

/**
 * GET /api/conversations/all
 *
 * Returns all conversation threads across the gym, grouped by action_id.
 * Each thread includes the AI evaluation (agent_decision) rows inline.
 * Sorted: open first, then by recency.
 *
 * Used by the Thread Inspector admin view (/threads).
 */
export async function GET(req: NextRequest) {
  const session = await getSession() as any
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const gymId = session.gymId ?? session.companyId ?? (session.isDemo ? 'demo' : null)

  // Fetch conversation rows — for demo sessions, scope to 'demo'; otherwise scope to gymId
  let query = supabase
    .from('agent_conversations')
    .select('id, action_id, role, text, created_at, member_name, member_email', { count: 'exact' })
    .order('created_at', { ascending: true })
    .limit(2000)

  if (session.isDemo) {
    query = query.eq('gym_id', 'demo')
  } else if (gymId) {
    query = query.eq('gym_id', gymId)
  }

  const { data: convRows, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by action_id into threads
  const threadMap: Record<string, any> = {}

  for (const row of convRows ?? []) {
    if (!threadMap[row.action_id]) {
      threadMap[row.action_id] = {
        action_id: row.action_id,
        member_name: row.member_name ?? 'Unknown',
        member_email: row.member_email ?? null,
        messages: [],
        started_at: row.created_at,
        last_at: row.created_at,
        resolved: false,
        needs_review: false,
      }
    }

    const msg = {
      ...row,
      _decision: row.role === 'agent_decision'
        ? (() => { try { return JSON.parse(row.text) } catch { return null } })()
        : null,
    }

    threadMap[row.action_id].messages.push(msg)
    threadMap[row.action_id].last_at = row.created_at

    // Infer resolved from decision rows (live status enriched below via agent_actions)
    if (msg._decision?.action === 'close' || msg._decision?.resolved) {
      threadMap[row.action_id].resolved = true
    }
  }

  // Enrich with live status from agent_actions (resolved_at, needs_review, outcome_score)
  const { data: actions } = await supabase
    .from('agent_actions')
    .select('id, content, resolved_at, needs_review, approved, outcome_score, outcome_reason')

  for (const action of actions ?? []) {
    const token = action.content?._replyToken
    if (token && threadMap[token]) {
      threadMap[token].resolved = !!action.resolved_at || !!action.approved
      threadMap[token].needs_review = !!action.needs_review
      threadMap[token].action_db_id = action.id
      threadMap[token].outcome_score = action.outcome_score
      threadMap[token].outcome_reason = action.outcome_reason
    }
  }

  // Sort: open first, then escalated, then resolved; secondary sort by recency
  const sorted = Object.values(threadMap).sort((a: any, b: any) => {
    // Escalated floats to top of open
    if (!a.resolved && !b.resolved) {
      if (a.needs_review !== b.needs_review) return a.needs_review ? -1 : 1
    }
    // Open before resolved
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    // Most recent last_at first
    return new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  })

  return NextResponse.json({
    gym_id: gymId,
    total: sorted.length,
    threads: sorted,
  })
}
