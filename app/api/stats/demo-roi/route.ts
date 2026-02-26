export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const DEMO_GYM_ID = '00000000-0000-0000-0000-000000000001'
const COST_PER_RUN_USD = 0.003
const AVG_MEMBER_VALUE_USD = 150
const RETENTION_RATE = 0.30

/**
 * GET /api/stats/demo-roi
 * Returns stats from demo activity using agent_tasks + task_conversations.
 * Falls back to sensible defaults if no activity yet.
 */
export async function GET(req: NextRequest) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Count outbound messages sent by agent
  const { data: outboundRows } = await supabaseAdmin
    .from('task_conversations')
    .select('id, task_id, created_at')
    .eq('role', 'agent')
    .eq('gym_id', DEMO_GYM_ID)
    .gte('created_at', since)

  // Count inbound member replies
  const { data: inboundRows } = await supabaseAdmin
    .from('task_conversations')
    .select('id, task_id')
    .eq('role', 'member')
    .eq('gym_id', DEMO_GYM_ID)
    .gte('created_at', since)

  // Count resolved tasks (goal achieved)
  const { data: resolvedTasks } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, outcome_score, resolved_at')
    .eq('gym_id', DEMO_GYM_ID)
    .in('status', ['resolved'])
    .not('resolved_at', 'is', null)
    .gte('resolved_at', since)

  // Count unique tasks touched
  const allTaskIds = new Set([
    ...(outboundRows ?? []).map(r => r.task_id),
    ...(inboundRows ?? []).map(r => r.task_id),
  ])

  const totalRuns = outboundRows?.length ?? 0
  const totalReplies = inboundRows?.length ?? 0
  const totalResolved = resolvedTasks?.length ?? 0
  const uniqueThreads = allTaskIds.size

  const rawCost = (totalRuns * COST_PER_RUN_USD) + (totalReplies * 0.002)
  const retainedMembers = Math.max(totalResolved, Math.floor(uniqueThreads * RETENTION_RATE))
  const totalValue = retainedMembers * AVG_MEMBER_VALUE_USD
  const roi = rawCost > 0 ? Math.round(totalValue / rawCost) : totalValue > 0 ? 999 : 0

  if (totalRuns === 0) {
    return NextResponse.json({
      totalRuns: 0,
      totalReplies: 0,
      uniqueThreads: 0,
      totalResolved: 0,
      totalCostUsd: '0.00',
      totalValue: '0',
      roi: 0,
      seeded: true,
      note: 'No demo activity in last 24h — send an email to generate real stats',
    })
  }

  return NextResponse.json({
    totalRuns,
    totalReplies,
    uniqueThreads,
    totalResolved,
    totalCostUsd: rawCost.toFixed(2),
    totalValue: totalValue.toString(),
    roi,
    seeded: false,
  })
}
