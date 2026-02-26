export const dynamic = 'force-dynamic'

/**
 * People API — returns AI-generated task data for each person the agent flagged.
 *
 * No hardcoded domain columns (no "lastCheckin", "riskLevel").
 * Returns what the AI surfaced: priority, detail, type, recommended action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Demo session: return sample data
  if ((session as any).isDemo) {
    return NextResponse.json([
      { id: '1', name: 'Derek Walsh', email: 'derek@example.com', priority: 'high', status: 'awaiting_reply', outcome: null, taskType: 'churn_risk', title: 'Attendance dropping — hasn\'t visited in 12 days', detail: 'Derek used to come in 4x/week but hasn\'t been in for 12 days. This pattern often precedes cancellation.', recommendedAction: 'Send a personal check-in message', estimatedImpact: '$175/mo at risk', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 1 * 86400000).toISOString() },
      { id: '2', name: 'Priya Patel', email: 'priya@example.com', priority: 'medium', status: 'open', outcome: null, taskType: 'attendance_drop', title: 'Frequency declining — down from 3x to 1x/week', detail: 'Priya\'s visit frequency has dropped significantly over the past 3 weeks.', recommendedAction: 'Check in about schedule or class preferences', estimatedImpact: '$150/mo at risk', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
      { id: '3', name: 'Alex Martinez', email: 'alex@example.com', priority: 'high', status: 'resolved', outcome: 'engaged', taskType: 'churn_risk', title: 'Was at risk — now re-engaged', detail: 'Alex hadn\'t visited in 19 days. After outreach, checked in twice this week.', recommendedAction: null, estimatedImpact: '$175/mo retained', createdAt: new Date(Date.now() - 14 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 1 * 86400000).toISOString() },
      { id: '4', name: 'Sarah Johnson', email: 'sarah@example.com', priority: 'medium', status: 'awaiting_reply', outcome: null, taskType: 'renewal_at_risk', title: 'Membership renewal coming up — engagement low', detail: 'Sarah\'s membership renews in 10 days but visits have been declining.', recommendedAction: 'Reach out about renewal with a personal note', estimatedImpact: '$130/mo at risk', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: '5', name: 'Mike Torres', email: 'mike@example.com', priority: 'high', status: 'resolved', outcome: 'churned', taskType: 'win_back', title: 'Cancelled membership — win-back attempted', detail: 'Mike cancelled after 14 months. Win-back sequence completed with no response.', recommendedAction: null, estimatedImpact: '$175/mo lost', createdAt: new Date(Date.now() - 21 * 86400000).toISOString(), updatedAt: new Date(Date.now() - 7 * 86400000).toISOString() },
    ])
  }

  const account = await getAccountForUser(session.id)

  if (!account) {
    return NextResponse.json({ error: 'No account connected' }, { status: 400 })
  }

  // Return AI-generated task data — no hardcoded domain-specific columns
  const { data: tasks } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, member_name, member_email, status, outcome, task_type, goal, priority, context, created_at, updated_at')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (tasks ?? []).map((t: any) => {
    const ctx = t.context ?? {}
    return {
      id: t.id,
      name: t.member_name ?? ctx.memberName ?? 'Unknown',
      email: t.member_email ?? ctx.memberEmail ?? '',
      priority: t.priority ?? ctx.priority ?? 'medium',
      status: t.status,
      outcome: t.outcome,
      taskType: t.task_type ?? ctx.insightType ?? '',
      title: t.goal ?? ctx.title ?? null,
      detail: ctx.detail ?? ctx.insights ?? ctx.riskReason ?? null,
      recommendedAction: ctx.recommendedAction ?? null,
      estimatedImpact: ctx.estimatedImpact ?? null,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }
  })

  return NextResponse.json(rows)
}
