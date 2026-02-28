export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/conversations/by-task?taskId=xxx
 *
 * Returns the conversation thread for a specific task.
 * Used by ActionSlidePanel to show history inline with the task.
 */
export async function GET(req: NextRequest) {
  const session = await getSession() as any
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const taskId = req.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const accountId = session.accountId ?? session.companyId ?? (session.isDemo ? '00000000-0000-0000-0000-000000000001' : null)
  if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 400 })

  // Verify the task belongs to this account before returning conversations
  const { data: task } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, status, member_name, member_email, outcome, outcome_score')
    .eq('id', taskId)
    .eq('account_id', accountId)
    .single()

  if (!task) return NextResponse.json({ messages: [] })

  const { data: messages, error } = await supabaseAdmin
    .from('task_conversations')
    .select('id, role, content, agent_name, evaluation, created_at')
    .eq('task_id', taskId)
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    taskId,
    status: task.status,
    messages: messages ?? [],
  })
}
