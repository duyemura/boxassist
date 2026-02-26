export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Demo session: return sample activity
  if ((session as any).isDemo) {
    const now = Date.now()
    return NextResponse.json([
      { id: '1', type: 'outreach', memberName: 'Alex M.', detail: 'Reached out to Alex M.', outcome: null, createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
      { id: '2', type: 'reply', memberName: 'Sarah K.', detail: 'Sarah replied: "Been traveling, back next week!"', outcome: null, createdAt: new Date(now - 5 * 60 * 60 * 1000).toISOString() },
      { id: '3', type: 'followup', memberName: 'Sarah K.', detail: 'Agent followed up with class suggestions', outcome: null, createdAt: new Date(now - 4 * 60 * 60 * 1000).toISOString() },
      { id: '4', type: 'retained', memberName: 'Derek W.', detail: 'Derek checked in after outreach', outcome: 'engaged', createdAt: new Date(now - 24 * 60 * 60 * 1000).toISOString() },
      { id: '5', type: 'churned', memberName: 'Lisa T.', detail: 'No response after 14 days', outcome: 'churned', createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() },
    ])
  }

  const account = await getAccountForUser(session.id)

  if (!account) {
    return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
  }

  // Fetch recent task conversations joined with tasks
  const { data: conversations } = await supabaseAdmin
    .from('task_conversations')
    .select('id, task_id, role, content, agent_name, created_at, agent_tasks(member_name, member_email, status, outcome)')
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(30)

  const activity = (conversations ?? []).map((c: any) => {
    const task = c.agent_tasks
    const memberName = task?.member_name ?? 'Member'

    let type = 'system'
    let detail = c.content

    if (c.role === 'agent') {
      type = 'outreach'
      detail = `Reached out to ${memberName}`
    } else if (c.role === 'member') {
      type = 'reply'
      detail = `${memberName} replied: "${c.content.slice(0, 80)}${c.content.length > 80 ? '...' : ''}"`
    } else if (c.role === 'system' && c.content.includes('close')) {
      type = task?.outcome === 'engaged' ? 'retained' : 'churned'
      detail = task?.outcome === 'engaged'
        ? `${memberName} is coming back`
        : `${memberName} — conversation closed`
    }

    return {
      id: c.id,
      type,
      memberName,
      detail,
      outcome: task?.outcome ?? null,
      createdAt: c.created_at,
    }
  })

  return NextResponse.json(activity)
}
