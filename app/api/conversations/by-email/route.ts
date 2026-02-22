import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/conversations/by-email?email=dan@pushpress.com
 * Returns full conversation history for a member across all threads,
 * grouped by action_id (thread), newest thread first.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'No email' }, { status: 400 })

  const { data, error } = await supabase
    .from('agent_conversations')
    .select('id, action_id, role, text, created_at, member_name')
    .eq('member_email', email)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by action_id (thread)
  const threads: Record<string, any> = {}
  for (const row of data ?? []) {
    if (!threads[row.action_id]) {
      threads[row.action_id] = {
        action_id: row.action_id,
        member_name: row.member_name,
        messages: [],
        started_at: row.created_at,
        last_at: row.created_at,
      }
    }
    threads[row.action_id].messages.push({
      ...row,
      _decision: row.role === 'agent_decision' ? (() => { try { return JSON.parse(row.text) } catch { return null } })() : null,
    })
    threads[row.action_id].last_at = row.created_at
  }

  // Sort threads newest first
  const sorted = Object.values(threads).sort((a: any, b: any) =>
    new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  )

  return NextResponse.json({ email, threads: sorted })
}
