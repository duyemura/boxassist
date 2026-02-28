export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import type { ParsedAgentConfig } from '../parse/route'
import { getAccountForUser } from '@/lib/db/accounts'
import { generateAgentInstructions } from '@/lib/agents/generate-instructions'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { config } = await req.json() as { config: ParsedAgentConfig }
  if (!config) return NextResponse.json({ error: 'config is required' }, { status: 400 })

  const isDemo = (session as any)?.isDemo
  const demoSessionId = (session as any)?.demoSessionId

  try {
    let accountId: string | null = null
    let accountName = 'Your Gym'

    if (!isDemo) {
      // Get gym for this user
      const account = await getAccountForUser(session.id)

      if (!account) return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
      accountId = account.id
      accountName = (account as any).account_name || (account as any).gym_name || (account as any).name || 'Your Gym'
    }

    // Auto-generate personalized instructions if system_prompt is empty
    if (!config.system_prompt?.trim() && config.name && config.skill_type) {
      try {
        config.system_prompt = await generateAgentInstructions({
          agentName: config.name,
          description: config.description || '',
          skillType: config.skill_type,
          accountName,
        })
      } catch { /* non-critical — deploy proceeds with null prompt */ }
    }

    // Create agent record
    // For real accounts: if an agent with the same skill_type already exists,
    // update it instead of creating a duplicate
    let skillType = config.skill_type
    if (!isDemo && accountId) {
      const { data: existing } = await supabaseAdmin
        .from('agents')
        .select('id, name')
        .eq('account_id', accountId)
        .eq('skill_type', skillType)
        .single()

      if (existing) {
        // Update existing agent instead of creating a duplicate
        await supabaseAdmin
          .from('agents')
          .update({
            name: config.name,
            description: config.description,
            system_prompt: config.system_prompt,
            trigger_mode: config.trigger_mode,
            trigger_event: config.trigger_event,
            cron_schedule: config.cron_schedule,
            action_type: config.action_type,
            data_sources: config.data_sources,
            is_active: true,
          })
          .eq('id', existing.id)

        // Update or create automation
        if (config.trigger_mode === 'cron' || config.trigger_mode === 'both') {
          await supabaseAdmin
            .from('agent_automations')
            .upsert({
              agent_id: existing.id,
              account_id: accountId,
              trigger_type: 'cron',
              cron_schedule: config.cron_schedule ?? 'daily',
              run_hour: (config as any).run_hour ?? 9,
              is_active: true,
            }, { onConflict: 'agent_id,trigger_type' })
        }

        return NextResponse.json({
          success: true,
          agent_id: existing.id,
          name: config.name,
          trigger_mode: config.trigger_mode,
          trigger_event: config.trigger_event,
          updated: true,
        })
      }
    }

    const insertData: any = {
      account_id: accountId,
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

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .insert(insertData)
      .select('id')
      .single()

    if (agentError || !agent) {
      console.error('Agent insert error:', agentError)
      return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
    }

    // Create automation records in agent_automations
    if (!isDemo && accountId) {
      // Cron automation
      if (config.trigger_mode === 'cron' || config.trigger_mode === 'both') {
        const { error: cronErr } = await supabaseAdmin
          .from('agent_automations')
          .insert({
            agent_id: agent.id,
            account_id: accountId,
            trigger_type: 'cron',
            cron_schedule: config.cron_schedule ?? 'daily',
            run_hour: (config as any).run_hour ?? 9,
            is_active: true,
          })
        if (cronErr) console.error('Cron automation insert error:', cronErr)
      }

      // Event automation
      if (
        (config.trigger_mode === 'event' || config.trigger_mode === 'both') &&
        config.trigger_event
      ) {
        const { error: eventErr } = await supabaseAdmin
          .from('agent_automations')
          .insert({
            agent_id: agent.id,
            account_id: accountId,
            trigger_type: 'event',
            event_type: config.trigger_event,
            is_active: true,
          })
        if (eventErr) console.error('Event automation insert error:', eventErr)

        // Legacy dual-write to agent_subscriptions during migration
        await supabaseAdmin
          .from('agent_subscriptions')
          .insert({
            account_id: accountId,
            agent_id: agent.id,
            event_type: config.trigger_event,
            is_active: true,
          })
          .then(() => {}, () => {}) // ignore errors on legacy write
      }
    }

    return NextResponse.json({
      success: true,
      agent_id: agent.id,
      name: config.name,
      trigger_mode: config.trigger_mode,
      trigger_event: config.trigger_event
    })
  } catch (error: any) {
    console.error('Deploy agent error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
