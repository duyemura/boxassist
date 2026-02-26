export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'
import { decrypt } from '@/lib/encrypt'
import { deregisterGymAgentsWebhook } from '@/lib/pushpress-sdk'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await getAccountForUser(session.id)

  if (account) {
    // Deactivate the PushPress webhook if we registered one
    if (account.webhook_id && account.pushpress_api_key && account.pushpress_company_id) {
      try {
        const apiKey = decrypt(account.pushpress_api_key as string)
        await deregisterGymAgentsWebhook(
          { apiKey, companyId: account.pushpress_company_id as string },
          account.webhook_id as string
        )
        console.log(`[disconnect] Deactivated webhook ${account.webhook_id}`)
      } catch (err: any) {
        console.warn('[disconnect] Failed to deactivate webhook:', err.message)
      }
    }

    await supabaseAdmin.from('agents').delete().eq('account_id', account.id)
    await supabaseAdmin.from('agent_runs').delete().eq('account_id', account.id)
    await supabaseAdmin.from('webhook_events').delete().eq('account_id', account.id)
    await supabaseAdmin.from('agent_subscriptions').delete().eq('account_id', account.id)
    await supabaseAdmin.from('accounts').delete().eq('id', account.id)
  }

  return NextResponse.json({ success: true })
}
