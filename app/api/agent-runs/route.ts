import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export const dynamic = 'force-dynamic'

const DEMO_RUNS = [
  {
    id: 'demo-r1',
    completed_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    members_scanned: 31,
    actions_taken: 3,
    messages_sent: 3,
    cost_usd: '0.0024',
    billed_usd: '0.24',
    attributed_value_usd: '130',
    status: 'completed',
  },
  {
    id: 'demo-r2',
    completed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    members_scanned: 31,
    actions_taken: 1,
    messages_sent: 1,
    cost_usd: '0.0022',
    billed_usd: '0.22',
    attributed_value_usd: null,
    status: 'completed',
  },
  {
    id: 'demo-r3',
    completed_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
    members_scanned: 31,
    actions_taken: 0,
    messages_sent: 0,
    cost_usd: '0.0018',
    billed_usd: '0.18',
    attributed_value_usd: null,
    status: 'completed',
  },
  {
    id: 'demo-r4',
    completed_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
    members_scanned: 31,
    actions_taken: 2,
    messages_sent: 2,
    cost_usd: '0.0022',
    billed_usd: '0.22',
    attributed_value_usd: '260',
    status: 'completed',
  },
  {
    id: 'demo-r5',
    completed_at: new Date(Date.now() - 97 * 60 * 60 * 1000).toISOString(),
    members_scanned: 31,
    actions_taken: 1,
    messages_sent: 1,
    cost_usd: '0.0020',
    billed_usd: '0.20',
    attributed_value_usd: null,
    status: 'completed',
  },
]

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '5'), 20)

  const isDemo = (session as any).isDemo
  if (isDemo) {
    return NextResponse.json({ runs: DEMO_RUNS.slice(0, limit) })
  }

  // Resolve gym id
  const accountId = (session as any).accountId
  let resolvedGymId = accountId
  if (!resolvedGymId) {
    const account = await getAccountForUser(session.id)
    if (!account) return NextResponse.json({ error: 'no gym' }, { status: 400 })
    resolvedGymId = account.id
  }

  const { data: runs, error } = await supabaseAdmin
    .from('agent_runs')
    .select('id, completed_at, members_scanned, actions_taken, messages_sent, cost_usd, billed_usd, attributed_value_usd, status, created_at')
    .eq('account_id', resolvedGymId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('agent-runs fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ runs: runs ?? [] })
}
