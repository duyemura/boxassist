import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { timeSavedValue } from '@/lib/cost'
import { getAccountForUser } from '@/lib/db/accounts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const isDemo = (session as any).isDemo
  if (isDemo) {
    return NextResponse.json(DEMO_ROI_STATS)
  }

  const accountId = (session as any).accountId
  // Fall back to looking up gym by user id if accountId not in token
  let resolvedGymId = accountId
  if (!resolvedGymId) {
    const account = await getAccountForUser(session.id)
    if (!account) return NextResponse.json({ error: 'no gym' }, { status: 400 })
    resolvedGymId = account.id
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Runs this month
  const { data: runs } = await supabaseAdmin
    .from('agent_runs')
    .select('id, actions_taken, messages_sent, cost_usd, billed_usd, attributed_value_usd, time_saved_minutes, completed_at')
    .eq('account_id', resolvedGymId)
    .eq('status', 'completed')
    .gte('completed_at', thirtyDaysAgo)

  // Actions this month
  const { data: actions } = await supabaseAdmin
    .from('agent_run_actions')
    .select('outcome, actual_value_usd, estimated_value_usd, action_type')
    .eq('account_id', resolvedGymId)
    .gte('created_at', thirtyDaysAgo)

  const totalRuns = runs?.length ?? 0
  const totalMessages = runs?.reduce((s, r) => s + (r.messages_sent ?? 0), 0) ?? 0
  const totalCostUsd = runs?.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) ?? 0
  const totalBilledUsd = runs?.reduce((s, r) => s + Number(r.billed_usd ?? 0), 0) ?? 0
  const totalTimeSavedMin = runs?.reduce((s, r) => s + (r.time_saved_minutes ?? 0), 0) ?? 0
  const timeSavedDollars = timeSavedValue(totalTimeSavedMin)

  const attributed =
    actions?.filter(
      a => a.outcome === 'checkin' || a.outcome === 'renewal' || a.outcome === 'payment'
    ) ?? []
  const revenueRetained = attributed.reduce(
    (s, a) => s + Number(a.actual_value_usd ?? a.estimated_value_usd ?? 0),
    0
  )
  const membersSaved = attributed.length
  const cacAvoided = membersSaved * 250 // default CAC

  const totalValue = revenueRetained + cacAvoided + timeSavedDollars
  const roi = totalBilledUsd > 0 ? Math.round(totalValue / totalBilledUsd) : 0

  return NextResponse.json({
    period: '30d',
    totalRuns,
    totalMessages,
    totalCostUsd: totalCostUsd.toFixed(4),
    totalBilledUsd: totalBilledUsd.toFixed(4),
    totalTimeSavedMin,
    timeSavedDollars: timeSavedDollars.toFixed(2),
    revenueRetained: revenueRetained.toFixed(2),
    membersSaved,
    cacAvoided: cacAvoided.toFixed(2),
    totalValue: totalValue.toFixed(2),
    roi,
    actionsTotal: actions?.length ?? 0,
    actionsPending: actions?.filter(a => a.outcome === 'pending').length ?? 0,
  })
}

const DEMO_ROI_STATS = {
  period: '30d',
  totalRuns: 14,
  totalMessages: 31,
  totalCostUsd: '0.0420',
  totalBilledUsd: '3.40',
  totalTimeSavedMin: 155,
  timeSavedDollars: '103.33',
  revenueRetained: '390.00',
  membersSaved: 3,
  cacAvoided: '750.00',
  totalValue: '1243.33',
  roi: 366,
  actionsTotal: 31,
  actionsPending: 8,
}
