export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

// Verify the agent belongs to the requesting user's account
async function getOwnedAgent(agentId: string, userId: string) {
  const account = await getAccountForUser(userId)
  if (!account) return null

  const { data } = await supabaseAdmin
    .from('agents')
    .select('id, account_id')
    .eq('id', agentId)
    .eq('account_id', account.id)
    .single()

  return data
}

// PATCH /api/agents/[id] — update agent
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedAgent(params.id, session.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { name, description, skill_type, cron_schedule, system_prompt, active } = body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name.trim()
  if (description !== undefined) updates.description = description?.trim() ?? null
  if (skill_type !== undefined) updates.skill_type = skill_type.trim()
  if (cron_schedule !== undefined) updates.cron_schedule = cron_schedule
  if (system_prompt !== undefined) updates.system_prompt = system_prompt?.trim() || null
  if (active !== undefined) updates.is_active = active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('agents')
    .update(updates)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) {
    console.error('[agents/[id]] Update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ agent: data })
}

// DELETE /api/agents/[id] — delete agent
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedAgent(params.id, session.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Also clean up any agent_subscriptions for this agent
  await supabaseAdmin.from('agent_subscriptions').delete().eq('agent_id', params.id)

  const { error } = await supabaseAdmin.from('agents').delete().eq('id', params.id)

  if (error) {
    console.error('[agents/[id]] Delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
