export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/conversations/by-email?email=dan@pushpress.com
 * Returns all conversation threads for a member, grouped by task_id.
 * Each thread includes status from agent_tasks.
 *
 * Uses agent_tasks + task_conversations (no legacy agent_actions).
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'No email' }, { status: 400 })

  // Find tasks for this member
  const { data: tasks, error: tasksErr } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, status, member_name, member_email, outcome, outcome_score, resolved_at')
    .eq('member_email', email)

  if (tasksErr) return NextResponse.json({ error: tasksErr.message }, { status: 500 })

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ email, threads: [] })
  }

  const taskIds = tasks.map(t => t.id)
  const taskMap = new Map(tasks.map(t => [t.id, t]))

  // Fetch conversations for these tasks
  const { data: convRows, error } = await supabaseAdmin
    .from('task_conversations')
    .select('id, task_id, role, content, agent_name, evaluation, created_at')
    .in('task_id', taskIds)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by task_id
  const threadMap: Record<string, any> = {}
  for (const row of convRows ?? []) {
    const taskId = row.task_id
    if (!threadMap[taskId]) {
      const task = taskMap.get(taskId)
      threadMap[taskId] = {
        task_id: taskId,
        member_name: task?.member_name ?? 'Unknown',
        messages: [],
        started_at: row.created_at,
        last_at: row.created_at,
        resolved: task?.status === 'resolved' || task?.status === 'cancelled',
        needs_review: task?.status === 'escalated',
        status: task?.status,
      }
    }
    threadMap[taskId].messages.push({
      id: row.id,
      role: row.role,
      content: row.content,
      agent_name: row.agent_name,
      evaluation: row.evaluation,
      created_at: row.created_at,
    })
    threadMap[taskId].last_at = row.created_at
  }

  const sorted = Object.values(threadMap).sort((a: any, b: any) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    return new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  })

  return NextResponse.json({ email, threads: sorted })
}
