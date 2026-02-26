export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser(session.id)
  if (!account) return NextResponse.json({ error: 'No account connected' }, { status: 400 })

  const body = await req.json()
  const { name, description, skill_type, cron_schedule, run_hour, system_prompt, active } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!skill_type?.trim()) return NextResponse.json({ error: 'skill_type is required' }, { status: 400 })

  // 1. Insert agent (capability only)
  const { data: agent, error } = await supabaseAdmin
    .from('agents')
    .insert({
      account_id: account.id,
      name: name.trim(),
      description: description?.trim() ?? null,
      skill_type: skill_type.trim(),
      trigger_mode: 'cron',        // legacy column — kept for backward compat
      cron_schedule: cron_schedule ?? 'daily',
      run_hour: run_hour ?? 9,
      system_prompt: system_prompt?.trim() || null,
      is_active: active ?? true,
      action_type: 'draft_message',
      run_count: 0,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[agents] Insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2. Create automation record
  await supabaseAdmin
    .from('agent_automations')
    .insert({
      agent_id: agent.id,
      account_id: account.id,
      trigger_type: 'cron',
      cron_schedule: cron_schedule ?? 'daily',
      run_hour: run_hour ?? 9,
      is_active: active ?? true,
    })

  return NextResponse.json({ agent }, { status: 201 })
}
