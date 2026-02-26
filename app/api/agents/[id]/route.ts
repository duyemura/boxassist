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
  const { name, description, skill_type, cron_schedule, run_hour, system_prompt, active } = body

  // Agent capability updates
  const agentUpdates: Record<string, unknown> = {}
  if (name !== undefined) agentUpdates.name = name.trim()
  if (description !== undefined) agentUpdates.description = description?.trim() ?? null
  if (skill_type !== undefined) agentUpdates.skill_type = skill_type.trim()
  if (system_prompt !== undefined) agentUpdates.system_prompt = system_prompt?.trim() || null
  if (active !== undefined) agentUpdates.is_active = active
  // Legacy dual-write: keep old columns in sync during migration
  if (cron_schedule !== undefined) agentUpdates.cron_schedule = cron_schedule
  if (run_hour !== undefined) agentUpdates.run_hour = run_hour

  if (Object.keys(agentUpdates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('agents')
    .update(agentUpdates)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) {
    console.error('[agents/[id]] Update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Automation updates (schedule fields)
  if (cron_schedule !== undefined || run_hour !== undefined || active !== undefined) {
    const autoUpdates: Record<string, unknown> = {}
    if (cron_schedule !== undefined) autoUpdates.cron_schedule = cron_schedule
    if (run_hour !== undefined) autoUpdates.run_hour = run_hour
    if (active !== undefined) autoUpdates.is_active = active

    await supabaseAdmin
      .from('agent_automations')
      .update(autoUpdates)
      .eq('agent_id', params.id)
  }

  return NextResponse.json({ agent: data })
}

// DELETE /api/agents/[id] — delete agent
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedAgent(params.id, session.id)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // agent_automations cascade on agent delete, but clean up explicitly for safety
  await supabaseAdmin.from('agent_automations').delete().eq('agent_id', params.id)
  // Legacy cleanup
  await supabaseAdmin.from('agent_subscriptions').delete().eq('agent_id', params.id)

  const { error } = await supabaseAdmin.from('agents').delete().eq('id', params.id)

  if (error) {
    console.error('[agents/[id]] Delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
