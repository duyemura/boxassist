import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const COST_PER_RUN_USD = 0.003       // ~$0.003 per agent run (Claude Haiku)
const AVG_MEMBER_VALUE_USD = 150     // avg monthly membership value
const RETENTION_RATE = 0.30          // 30% of outreach converts to retention

/**
 * GET /api/stats/demo-roi
 * Returns real stats derived from actual demo activity in agent_conversations.
 * Falls back to sensible defaults if no activity yet.
 */
export async function GET(req: NextRequest) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Count outbound messages sent (each = one agent run)
  const { data: outboundRows } = await supabase
    .from('agent_conversations')
    .select('id, action_id, created_at')
    .eq('role', 'outbound')
    .eq('gym_id', 'demo')
    .gte('created_at', since)

  // Count inbound replies received
  const { data: inboundRows } = await supabase
    .from('agent_conversations')
    .select('id, action_id')
    .eq('role', 'inbound')
    .eq('gym_id', 'demo')
    .gte('created_at', since)

  // Count resolved actions (goal achieved)
  const { data: resolvedActions } = await supabase
    .from('agent_actions')
    .select('id, outcome_score, resolved_at')
    .eq('approved', true)
    .not('resolved_at', 'is', null)
    .gte('resolved_at', since)

  // Count unique threads touched (unique action_ids with any activity)
  const allActionIds = new Set([
    ...(outboundRows ?? []).map(r => r.action_id),
    ...(inboundRows ?? []).map(r => r.action_id),
  ])

  const totalRuns = outboundRows?.length ?? 0
  const totalReplies = inboundRows?.length ?? 0
  const totalResolved = resolvedActions?.length ?? 0
  const uniqueThreads = allActionIds.size

  // Cost: $0.003 per outbound + $0.002 per reply evaluation
  const rawCost = (totalRuns * COST_PER_RUN_USD) + (totalReplies * 0.002)

  // Value: each resolved thread = prevented churn = 1 month membership saved
  const retainedMembers = Math.max(totalResolved, Math.floor(uniqueThreads * RETENTION_RATE))
  const totalValue = retainedMembers * AVG_MEMBER_VALUE_USD

  // ROI: value / cost (min 1x)
  const roi = rawCost > 0 ? Math.round(totalValue / rawCost) : totalValue > 0 ? 999 : 0

  // If no real activity yet, return seeded defaults that feel real
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
