export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { encrypt } from '@/lib/encrypt'
import { createPushPressClient, getMemberStats } from '@/lib/pushpress'
import { registerGymAgentsWebhook } from '@/lib/pushpress-sdk'
import { bootstrapBusinessProfile, seedGMAgent } from '@/lib/agents/bootstrap'
import { callClaude } from '@/lib/claude'
import { HAIKU } from '@/lib/models'
import { getAccountForUser } from '@/lib/db/accounts'

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

    // ── Step 2: Find or create the account ───────────────────────────────────
    // Look up by company ID first (stable PushPress identifier).
    // Then check if user already has an account (key rotation).
    // Otherwise create a new account.
    let accountId: string | null = null

    if (resolvedCompanyId) {
      const { data: byCompany } = await supabaseAdmin
        .from('accounts')
        .select('id')
        .eq('pushpress_company_id', resolvedCompanyId)
        .single()

      if (byCompany) {
        // Gym already in DB — update credentials
        console.log(`[connect] Account ${byCompany.id} already registered, updating credentials`)
        const { error } = await supabaseAdmin
          .from('accounts')
          .update({
            pushpress_api_key: encryptedApiKey,
            pushpress_company_id: resolvedCompanyId,
            account_name: accountName,
            member_count: memberCount,
            connected_at: new Date().toISOString()
          })
          .eq('id', byCompany.id)
        if (error) {
          console.error('[connect] Update failed:', error)
          return NextResponse.json({ error: `Failed to update gym: ${error.message}` }, { status: 500 })
        }
        accountId = byCompany.id
      }
    }

    if (!accountId) {
      // Check if current user already owns an account (key rotation)
      const existing = await getAccountForUser(session.id)

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
          .eq('id', existing.id)
        if (error) {
          console.error('[connect] Update failed:', error)
          return NextResponse.json({ error: `Failed to update gym: ${error.message}` }, { status: 500 })
        }
        accountId = existing.id as string
      } else {
        // Brand new account
        const { data: newAccount, error } = await supabaseAdmin
          .from('accounts')
          .insert({
            pushpress_api_key: encryptedApiKey,
            pushpress_company_id: resolvedCompanyId,
            account_name: accountName,
            member_count: memberCount,
            connected_at: new Date().toISOString()
          })
          .select('id')
          .single()
        if (error || !newAccount) {
          console.error('[connect] Insert failed:', error)
          return NextResponse.json({ error: `Failed to save gym: ${error?.message}` }, { status: 500 })
        }
        accountId = newAccount.id
      }
    }

    // ── Step 3: Ensure user is an owner in team_members ──────────────────────
    await supabaseAdmin
      .from('team_members')
      .upsert(
        { account_id: accountId, user_id: session.id, role: 'owner' },
        { onConflict: 'account_id,user_id' }
      )

    // ── Step 4: Auto-register webhook with PushPress ─────────────────────────
    let webhookRegistered = false
    let webhookId: string | null = null

    try {
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

      await supabaseAdmin
        .from('accounts')
        .update({ webhook_id: result.webhookId })
        .eq('id', accountId)

      console.log(
        `[connect] Webhook ${result.alreadyExisted ? 'already existed' : 'registered'}: ${result.webhookId}`
      )
    } catch (err: any) {
      // Non-fatal — gym is connected even if webhook registration fails
      console.error('[connect] Webhook registration failed:', err.message)
    }

    // ── Step 5: Seed GM agent (idempotent) ───────────────────────────────────
    seedGMAgent(accountId!).catch(err =>
      console.error('[connect] GM seed failed:', (err as Error).message)
    )

    // ── Step 6: Bootstrap business profile (fire-and-forget) ─────────────────
    bootstrapBusinessProfile(
      { accountId: accountId!, accountName, memberCount },
      { claude: { evaluate: (system, prompt) => callClaude(system, prompt, HAIKU) } },
    ).catch(err => console.error('[connect] Bootstrap failed:', (err as Error).message))

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
