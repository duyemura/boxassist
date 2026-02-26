export const dynamic = 'force-dynamic'

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
    const { apiKey, companyId: providedCompanyId } = await req.json()

    if (!apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    // ── Step 1: Call PushPress to validate key and get gym identity ───────────
    const client = createPushPressClient(apiKey, providedCompanyId ?? '')
    let accountName = 'Your Gym'
    let memberCount = 0
    let resolvedCompanyId = providedCompanyId ?? ''

    try {
      const stats = await getMemberStats(client, providedCompanyId ?? '')
      accountName = stats.accountName
      memberCount = stats.totalMembers
      if (stats.companyId) resolvedCompanyId = stats.companyId
    } catch (err: any) {
      console.log('[connect] Stats fetch failed, proceeding:', err.message)
    }

    const encryptedApiKey = encrypt(apiKey)

    // ── Step 2: Look up existing gym by company ID (stable PushPress identifier)
    // If found: transfer ownership to current user (same gym, new login).
    // If not found: check if current user already has a gym (key rotation),
    //               otherwise create a fresh row.
    let gymRow: { id: string; webhook_id: string | null } | null = null

    if (resolvedCompanyId) {
      const { data: byCompany } = await supabaseAdmin
        .from('accounts')
        .select('id, webhook_id')
        .eq('pushpress_company_id', resolvedCompanyId)
        .single()

      if (byCompany) {
        // Gym already in DB — claim it for this user
        console.log(`[connect] Gym ${byCompany.id} already registered, transferring to user ${session.id}`)
        const { error } = await supabaseAdmin
          .from('accounts')
          .update({
            user_id: session.id,
            pushpress_api_key: encryptedApiKey,
            pushpress_company_id: resolvedCompanyId,
            account_name: accountName,
            member_count: memberCount,
            connected_at: new Date().toISOString()
          })
          .eq('id', byCompany.id)
        if (error) {
          console.error('[connect] Transfer failed:', error)
          return NextResponse.json({ error: `Failed to claim gym: ${error.message}` }, { status: 500 })
        }
        gymRow = byCompany
      }
    }

    if (!gymRow) {
      // No existing gym found by company ID — check if current user already has one (key rotation)
      const { data: existing } = await supabaseAdmin
        .from('accounts')
        .select('id, webhook_id')
        .eq('user_id', session.id)
        .single()

      if (existing) {
        const { error } = await supabaseAdmin
          .from('accounts')
          .update({
            pushpress_api_key: encryptedApiKey,
            pushpress_company_id: resolvedCompanyId,
            account_name: accountName,
            member_count: memberCount,
            connected_at: new Date().toISOString()
          })
          .eq('user_id', session.id)
        if (error) {
          console.error('[connect] Update failed:', error)
          return NextResponse.json({ error: `Failed to update gym: ${error.message}` }, { status: 500 })
        }
        gymRow = existing
      } else {
        // Brand new gym
        const { error } = await supabaseAdmin
          .from('accounts')
          .insert({
            user_id: session.id,
            pushpress_api_key: encryptedApiKey,
            pushpress_company_id: resolvedCompanyId,
            account_name: accountName,
            member_count: memberCount,
            connected_at: new Date().toISOString()
          })
        if (error) {
          console.error('[connect] Insert failed:', error)
          return NextResponse.json({ error: `Failed to save gym: ${error.message}` }, { status: 500 })
        }
      }
    }

    // Re-fetch to get current gym row (ID needed for webhook + autopilot steps)
    const { data: account } = await supabaseAdmin
      .from('accounts')
      .select('id, webhook_id')
      .eq('user_id', session.id)
      .single()

    if (!account) {
      return NextResponse.json({ error: 'Gym was saved but could not be retrieved' }, { status: 500 })
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Auto-register GymAgents webhook with PushPress
    // This means zero manual setup for gym owners — it just works.
    // ──────────────────────────────────────────────────────────────────────────
    let webhookRegistered = false
    let webhookId: string | null = null

    try {
      // Determine the deployment URL for the webhook
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        'https://app-orcin-one-70.vercel.app'

      const result = await registerGymAgentsWebhook(
        { apiKey, companyId: resolvedCompanyId },
        appUrl
      )

      webhookId = result.webhookId
      webhookRegistered = true

      // Store webhook ID so we can deactivate it on disconnect
      if (account) {
        await supabaseAdmin
          .from('accounts')
          .update({ webhook_id: result.webhookId })
          .eq('id', account.id)
      }

      console.log(
        `[connect] Webhook ${result.alreadyExisted ? 'already existed' : 'registered'}: ${result.webhookId}`
      )
    } catch (err: any) {
      // Non-fatal — gym is connected even if webhook registration fails
      console.error('[connect] Webhook registration failed:', err.message)
    }

    // Ensure this user is in team_members for the account
    if (account) {
      await supabaseAdmin
        .from('team_members')
        .upsert(
          { account_id: account.id, user_id: session.id, role: 'owner' },
          { onConflict: 'account_id,user_id' }
        )
    }

    // Create default at_risk_detector autopilot if not existing
    if (account) {
      const { data: existingAutopilot } = await supabaseAdmin
        .from('autopilots')
        .select('id')
        .eq('account_id', account.id)
        .eq('skill_type', 'at_risk_detector')
        .single()

      if (!existingAutopilot) {
        await supabaseAdmin.from('autopilots').insert({
          account_id: account.id,
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
      accountName,
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
