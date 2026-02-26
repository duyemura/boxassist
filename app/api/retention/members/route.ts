export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Demo session: return sample members
  if ((session as any).isDemo) {
    return NextResponse.json([
      { id: '1', name: 'Derek Walsh', email: 'derek@example.com', riskLevel: 'high', lastCheckin: '12 days ago', status: 'awaiting_reply', outcome: null },
      { id: '2', name: 'Priya Patel', email: 'priya@example.com', riskLevel: 'medium', lastCheckin: '8 days ago', status: 'open', outcome: null },
      { id: '3', name: 'Alex Martinez', email: 'alex@example.com', riskLevel: 'high', lastCheckin: '19 days ago', status: 'resolved', outcome: 'engaged' },
      { id: '4', name: 'Sarah Johnson', email: 'sarah@example.com', riskLevel: 'medium', lastCheckin: '6 days ago', status: null, outcome: null },
      { id: '5', name: 'Mike Torres', email: 'mike@example.com', riskLevel: 'high', lastCheckin: '25 days ago', status: 'resolved', outcome: 'churned' },
    ])
  }

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  // Get tasks with member info, ordered by risk
  const { data: tasks } = await supabaseAdmin
    .from('agent_tasks')
    .select('id, member_name, member_email, status, outcome, context, created_at, updated_at')
    .eq('gym_id', gym.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const members = (tasks ?? []).map((t: any) => {
    const ctx = t.context ?? {}
    return {
      id: t.id,
      name: t.member_name ?? ctx.memberName ?? 'Member',
      email: t.member_email ?? ctx.memberEmail ?? '',
      riskLevel: ctx.riskLevel ?? ctx.priority ?? 'medium',
      lastCheckin: ctx.lastCheckin ?? null,
      status: t.status,
      outcome: t.outcome,
    }
  })

  return NextResponse.json(members)
}
