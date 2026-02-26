export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/skills — return system skills + this gym's custom skills
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get the gym for this user
  let gymId: string | null = null
  if (!(session as any).isDemo) {
    const { data: gym } = await supabaseAdmin
      .from('gyms')
      .select('id')
      .eq('user_id', session.id)
      .single()
    gymId = gym?.id ?? null
  }

  // Fetch system skills (gym_id IS NULL, is_system = true)
  const { data: systemSkills, error: sysErr } = await supabaseAdmin
    .from('skills')
    .select('*')
    .is('gym_id', null)
    .eq('is_system', true)
    .order('category')
    .order('name')

  if (sysErr) {
    return NextResponse.json({ error: sysErr.message }, { status: 500 })
  }

  // Fetch this gym's custom skills
  let gymSkills: any[] = []
  if (gymId) {
    const { data, error } = await supabaseAdmin
      .from('skills')
      .select('*')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
    if (!error) gymSkills = data ?? []
  }

  // Return system skills first, then gym-specific overrides/custom skills
  // If a gym has cloned a system skill, it will appear in gymSkills with a gym_id
  const skills = [...(systemSkills ?? []), ...gymSkills]

  return NextResponse.json({ skills })
}

// POST /api/skills — create a new custom skill for this gym
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session as any).isDemo) return NextResponse.json({ error: 'Not available in demo' }, { status: 403 })

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id')
    .eq('user_id', session.id)
    .single()

  if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

  const body = await req.json()
  const { name, description, category, trigger_condition, system_prompt, tone_guidance, escalation_rules, success_criteria, followup_cadence, default_value_usd } = body

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  // Generate a slug from the name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const { data: skill, error } = await supabaseAdmin
    .from('skills')
    .insert({
      gym_id: gym.id,
      slug,
      name,
      description: description ?? null,
      category: category ?? 'retention',
      trigger_condition: trigger_condition ?? null,
      system_prompt: system_prompt ?? description ?? name,
      tone_guidance: tone_guidance ?? null,
      escalation_rules: escalation_rules ?? null,
      success_criteria: success_criteria ?? null,
      followup_cadence: followup_cadence ?? null,
      default_value_usd: default_value_usd ?? 130,
      is_system: false,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ skill }, { status: 201 })
}
