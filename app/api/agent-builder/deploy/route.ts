export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import type { ParsedAgentConfig } from '../parse/route'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { config } = await req.json() as { config: ParsedAgentConfig }
  if (!config) return NextResponse.json({ error: 'config is required' }, { status: 400 })

  const isDemo = (session as any)?.isDemo
  const demoSessionId = (session as any)?.demoSessionId

  try {
    let gymId: string | null = null

    if (!isDemo) {
      // Get gym for this user
      const { data: gym } = await supabaseAdmin
        .from('gyms')
        .select('id')
        .eq('user_id', session.id)
        .single()

      if (!gym) return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
      gymId = gym.id
    }

    // Create autopilot record
    // For real gyms: skill_type must be unique per gym — dedupe with timestamp if collision
    let skillType = config.skill_type
    if (!isDemo && gymId) {
      const { data: existing } = await supabaseAdmin
        .from('autopilots')
        .select('id')
        .eq('gym_id', gymId)
        .eq('skill_type', skillType)
        .single()

      if (existing) {
        skillType = `${config.skill_type}_${Date.now()}`
      }
    }

    const insertData: any = {
      gym_id: gymId,
      skill_type: skillType,
      name: config.name,
      description: config.description,
      system_prompt: config.system_prompt,
      trigger_mode: config.trigger_mode,
      trigger_event: config.trigger_event,
      cron_schedule: config.cron_schedule,
      action_type: config.action_type,
      data_sources: config.data_sources,
      is_active: true,
      run_count: 0,
      approval_rate: 0,
      trigger_config: {}
    }

    // Tag demo agents with session scope and expiry
    if (isDemo && demoSessionId) {
      insertData.demo_session_id = demoSessionId
      insertData.user_id = `demo-${demoSessionId}`
      insertData.gym_id = null // no FK to gyms for demo rows
      insertData.expires_at = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    } else {
      insertData.user_id = session.id
    }

    const { data: autopilot, error: apError } = await supabaseAdmin
      .from('autopilots')
      .insert(insertData)
      .select('id')
      .single()

    if (apError || !autopilot) {
      console.error('Autopilot insert error:', apError)
      return NextResponse.json({ error: 'Failed to create autopilot' }, { status: 500 })
    }

    // If event-triggered and not demo, create agent_subscription record
    if (
      !isDemo &&
      gymId &&
      (config.trigger_mode === 'event' || config.trigger_mode === 'both') &&
      config.trigger_event
    ) {
      const { error: subError } = await supabaseAdmin
        .from('agent_subscriptions')
        .insert({
          gym_id: gymId,
          autopilot_id: autopilot.id,
          event_type: config.trigger_event,
          is_active: true
        })

      if (subError) {
        console.error('Subscription insert error:', subError)
        // Non-fatal — autopilot was created, subscription failed
      }
    }

    return NextResponse.json({
      success: true,
      autopilot_id: autopilot.id,
      name: config.name,
      trigger_mode: config.trigger_mode,
      trigger_event: config.trigger_event
    })
  } catch (error: any) {
    console.error('Deploy agent error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
