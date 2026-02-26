export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/conversations/all
 *
 * Returns all conversation threads across the gym, grouped by task_id.
 * Each thread includes the task status and outcome from agent_tasks.
 * Sorted: open first, then by recency.
 *
 * Uses agent_tasks + task_conversations (no legacy agent_actions).
 */
export async function GET(req: NextRequest) {
  const session = await getSession() as any
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gymId = session.gymId ?? session.companyId ?? (session.isDemo ? '00000000-0000-0000-0000-000000000001' : null)

  if (!gymId) return NextResponse.json({ error: 'No gym' }, { status: 400 })

  // Fetch conversation rows from task_conversations
  const { data: convRows, error } = await supabaseAdmin
    .from('task_conversations')
    .select('id, task_id, role, content, agent_name, evaluation, created_at')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: true })
    .limit(2000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch tasks for this gym to enrich threads with status
  const { data: tasks } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, status, member_name, member_email, outcome, outcome_score, outcome_reason, resolved_at, requires_approval')
    .eq('gym_id', gymId)

  const taskMap = new Map((tasks ?? []).map(t => [t.id, t]))

  // Group by task_id into threads
  const threadMap: Record<string, any> = {}

  for (const row of convRows ?? []) {
    const taskId = row.task_id
    if (!threadMap[taskId]) {
      const task = taskMap.get(taskId)
      threadMap[taskId] = {
        task_id: taskId,
        member_name: task?.member_name ?? 'Unknown',
        member_email: task?.member_email ?? null,
        messages: [],
        started_at: row.created_at,
        last_at: row.created_at,
        resolved: task?.status === 'resolved' || task?.status === 'cancelled',
        needs_review: task?.status === 'escalated',
        status: task?.status ?? 'unknown',
        outcome_score: task?.outcome_score,
        outcome_reason: task?.outcome_reason,
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

  // Sort: escalated first, then open, then resolved; secondary sort by recency
  const sorted = Object.values(threadMap).sort((a: any, b: any) => {
    if (!a.resolved && !b.resolved) {
      if (a.needs_review !== b.needs_review) return a.needs_review ? -1 : 1
    }
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    return new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  })

  return NextResponse.json({
    gym_id: gymId,
    total: sorted.length,
    threads: sorted,
  })
}
