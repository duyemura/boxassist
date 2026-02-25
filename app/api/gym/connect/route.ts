import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/encrypt'
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

    // ── Check if this API key is already registered to ANY gym ────────────────
    // AES-256-CBC uses a random IV so the same plaintext produces a different
    // ciphertext each time — we can't do a SQL lookup. Instead we fetch all gyms
    // (small table at this scale) and decrypt to find a match.
    const { data: allGyms } = await supabaseAdmin
      .from('gyms')
      .select('id, user_id, webhook_id, pushpress_api_key')

    let claimedGym: { id: string; user_id: string; webhook_id: string | null } | null = null
    for (const g of allGyms ?? []) {
      try {
        if (g.pushpress_api_key && decrypt(g.pushpress_api_key) === apiKey) {
          claimedGym = g
          break
        }
      } catch {
        // corrupt / legacy row — skip
      }
    }

    if (claimedGym) {
      // API key already exists — transfer ownership to current user and refresh metadata
      console.log(`[connect] API key already registered to gym ${claimedGym.id}, transferring to user ${session.id}`)
      const { error: transferError } = await supabaseAdmin
        .from('gyms')
        .update({
          user_id: session.id,
          pushpress_api_key: encryptedApiKey, // re-encrypt with fresh IV
          pushpress_company_id: companyId,
          gym_name: gymName,
          member_count: memberCount,
          connected_at: new Date().toISOString()
        })
        .eq('id', claimedGym.id)
      if (transferError) {
        console.error('[connect] Gym transfer failed:', transferError)
        return NextResponse.json({ error: `Failed to claim gym: ${transferError.message}` }, { status: 500 })
      }
    } else {
      // Check if current user already has a gym (different key — just update it)
      const { data: existingForUser } = await supabaseAdmin
        .from('gyms')
        .select('id')
        .eq('user_id', session.id)
        .single()

      if (existingForUser) {
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
