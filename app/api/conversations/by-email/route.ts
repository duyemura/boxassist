import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/conversations/by-email?email=dan@pushpress.com
 * Returns all conversation threads for a member, grouped by action_id.
 * Each thread includes resolved/open status from agent_actions.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'No email' }, { status: 400 })

  // Fetch all conversation rows for this email
  const { data: convRows, error } = await supabase
    .from('agent_conversations')
    .select('id, action_id, role, text, created_at, member_name')
    .eq('member_email', email)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by action_id
  const threadMap: Record<string, any> = {}
  for (const row of convRows ?? []) {
    if (!threadMap[row.action_id]) {
      threadMap[row.action_id] = {
        action_id: row.action_id,
        member_name: row.member_name,
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

    // Check if this decision row marked it closed
    if (msg._decision?.action === 'close' || msg._decision?.resolved) {
      threadMap[row.action_id].resolved = true
    }
  }

  // Enrich with live status from agent_actions (resolved_at, needs_review)
  const tokens = Object.keys(threadMap)
  if (tokens.length > 0) {
    const { data: actions } = await supabase
      .from('agent_actions')
      .select('id, content, resolved_at, needs_review, approved')
    
    for (const action of actions ?? []) {
      const token = action.content?._replyToken
      if (token && threadMap[token]) {
        threadMap[token].resolved = !!action.resolved_at || !!action.approved
        threadMap[token].needs_review = !!action.needs_review
        threadMap[token].action_db_id = action.id
      }
    }
  }

  // Sort threads: open first, then by recency
  const sorted = Object.values(threadMap).sort((a: any, b: any) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    return new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  })

  return NextResponse.json({ email, threads: sorted })
}
