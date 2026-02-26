export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

// Helper: get account id for current session
async function getGymId(session: any): Promise<string | null> {
  if ((session as any).isDemo) return null
  const account = await getAccountForUser(session.id)
  return (account?.id as string) ?? null
}

// GET /api/skills/[id] — fetch a single skill
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = await getGymId(session)

  const { data: skill, error } = await supabaseAdmin
    .from('skills')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !skill) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Must be a system skill or belong to this gym
  if (skill.gym_id !== null && skill.gym_id !== accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ skill })
}

// PATCH /api/skills/[id] — update a gym's own skill (not system skills)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session as any).isDemo) return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })

  const accountId = await getGymId(session)
  if (!accountId) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  // Verify the skill belongs to this gym (not a system skill)
  const { data: existing } = await supabaseAdmin
    .from('skills')
    .select('id, gym_id, is_system')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.is_system && existing.gym_id === null) {
    return NextResponse.json({ error: 'Cannot edit system skills — clone first' }, { status: 403 })
  }
  if (existing.gym_id !== accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const allowed = ['name', 'description', 'category', 'trigger_condition', 'system_prompt', 'tone_guidance', 'escalation_rules', 'success_criteria', 'followup_cadence', 'default_value_usd', 'is_active', 'automation_level']
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data: skill, error } = await supabaseAdmin
    .from('skills')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ skill })
}

// DELETE /api/skills/[id] — delete a gym's own skill (not system skills)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session as any).isDemo) return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })

  const accountId = await getGymId(session)
  if (!accountId) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  const { data: existing } = await supabaseAdmin
    .from('skills')
    .select('id, gym_id, is_system')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.is_system && existing.gym_id === null) {
    return NextResponse.json({ error: 'Cannot delete system skills' }, { status: 403 })
  }
  if (existing.gym_id !== accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('skills')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
