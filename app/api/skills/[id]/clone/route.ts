export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

// POST /api/skills/[id]/clone — clone a system skill into this gym's library
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session as any).isDemo) return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })

  // Get the gym
  const account = await getAccountForUser(session.id)

  if (!account) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  // Fetch the source skill (must be a system skill or accessible)
  const { data: source, error: fetchErr } = await supabaseAdmin
    .from('skills')
    .select('*')
    .eq('id', params.id)
    .single()

  if (fetchErr || !source) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })

  // Check if this gym already has a clone of this slug
  const { data: existing } = await supabaseAdmin
    .from('skills')
    .select('id')
    .eq('account_id', account.id)
    .eq('slug', source.slug)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'Already cloned', skill_id: existing.id }, { status: 409 })
  }

  // Create the clone (gym_id set, is_system = false)
  const { data: clone, error: insertErr } = await supabaseAdmin
    .from('skills')
    .insert({
      account_id: account.id,
      slug: source.slug,
      name: source.name,
      description: source.description,
      category: source.category,
      trigger_condition: source.trigger_condition,
      system_prompt: source.system_prompt,
      tone_guidance: source.tone_guidance,
      escalation_rules: source.escalation_rules,
      success_criteria: source.success_criteria,
      followup_cadence: source.followup_cadence,
      default_value_usd: source.default_value_usd,
      is_system: false,
      is_active: true,
      automation_level: source.automation_level ?? 'draft_only',
      version: source.version,
      author: source.author,
    })
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({ skill: clone }, { status: 201 })
}
