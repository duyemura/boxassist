import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { encrypt } from '@/lib/encrypt'
import { createPushPressClient, getMemberStats } from '@/lib/pushpress'
import { registerGymAgentsWebhook } from '@/lib/pushpress-sdk'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { apiKey, companyId } = await req.json()

    if (!apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    // Validate connection by fetching member stats
    // companyId is optional — the PushPress API-KEY header is sufficient for most calls
    const client = createPushPressClient(apiKey, companyId ?? '')
    let gymName = 'Your Gym'
    let memberCount = 0

    try {
      const stats = await getMemberStats(client, companyId ?? '')
      gymName = stats.gymName
      memberCount = stats.totalMembers
    } catch (err: any) {
      console.log('Stats fetch failed, proceeding with connection:', err.message)
    }

    // Encrypt API key before storing
    const encryptedApiKey = encrypt(apiKey)

    // Upsert gym record
    const { data: existing } = await supabaseAdmin
      .from('gyms')
      .select('id, webhook_id')
      .eq('user_id', session.id)
      .single()

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('gyms')
        .update({
          pushpress_api_key: encryptedApiKey,
          pushpress_company_id: companyId,
          gym_name: gymName,
          member_count: memberCount,
          connected_at: new Date().toISOString()
        })
        .eq('user_id', session.id)
      if (updateError) {
        console.error('[connect] Gym update failed:', updateError)
        return NextResponse.json({ error: `Failed to update gym: ${updateError.message}` }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('gyms')
        .insert({
          user_id: session.id,
          pushpress_api_key: encryptedApiKey,
          pushpress_company_id: companyId,
          gym_name: gymName,
          member_count: memberCount,
          connected_at: new Date().toISOString()
        })
      if (insertError) {
        console.error('[connect] Gym insert failed:', insertError)
        return NextResponse.json({ error: `Failed to save gym: ${insertError.message}` }, { status: 500 })
      }
    }

    // Fetch the gym record (for ID)
    const { data: gym } = await supabaseAdmin
      .from('gyms')
      .select('id, webhook_id')
      .eq('user_id', session.id)
      .single()

    // ──────────────────────────────────────────────────────────────────────────
    // Auto-register GymAgents webhook with PushPress
    // This means zero manual setup for gym owners — it just works.
    // ──────────────────────────────────────────────────────────────────────────
    let webhookRegistered = false
    let webhookId: string | null = null

    try {
      // Determine the deployment URL for the webhook
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ??           // explicit override
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null ??
        'https://app-orcin-one-70.vercel.app'        // fallback to known prod URL

      const result = await registerGymAgentsWebhook(
        { apiKey, companyId },
        appUrl
      )

      webhookId = result.webhookId
      webhookRegistered = true

      // Store webhook ID so we can deactivate it on disconnect
      if (gym) {
        await supabaseAdmin
          .from('gyms')
          .update({ webhook_id: result.webhookId })
          .eq('id', gym.id)
      }

      console.log(
        `[connect] Webhook ${result.alreadyExisted ? 'already existed' : 'registered'}: ${result.webhookId}`
      )
    } catch (err: any) {
      // Non-fatal — gym is connected even if webhook registration fails
      console.error('[connect] Webhook registration failed:', err.message)
    }

    // Create default at_risk_detector autopilot if not existing
    if (gym) {
      const { data: existingAutopilot } = await supabaseAdmin
        .from('autopilots')
        .select('id')
        .eq('gym_id', gym.id)
        .eq('skill_type', 'at_risk_detector')
        .single()

      if (!existingAutopilot) {
        await supabaseAdmin.from('autopilots').insert({
          gym_id: gym.id,
          skill_type: 'at_risk_detector',
          name: '🚨 At-Risk Member Detector',
          description: 'Finds members who are going quiet before they cancel',
          trigger_mode: 'cron',
          cron_schedule: 'daily',
          trigger_config: { threshold_days: 14 },
          action_type: 'draft_message',
          data_sources: ['customers-list', 'checkins-class-list'],
          is_active: true,
          run_count: 0,
          approval_rate: 0
        })
      }
    }

    return NextResponse.json({
      success: true,
      gymName,
      memberCount,
      webhookRegistered,
      webhookId,
      webhookUrl: webhookRegistered
        ? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app-orcin-one-70.vercel.app'}/api/webhooks/pushpress`
        : null
    })
  } catch (error: any) {
    console.error('Connect error:', error)
    return NextResponse.json({ error: error.message || 'Connection failed' }, { status: 500 })
  }
}
