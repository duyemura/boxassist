export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import { deregisterGymAgentsWebhook } from '@/lib/pushpress-sdk'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: gym } = await supabaseAdmin
    .from('gyms')
    .select('id, webhook_id, pushpress_api_key, pushpress_company_id')
    .eq('user_id', session.id)
    .single()

  if (gym) {
    // Deactivate the PushPress webhook if we registered one
    if (gym.webhook_id && gym.pushpress_api_key && gym.pushpress_company_id) {
      try {
        const apiKey = decrypt(gym.pushpress_api_key)
        await deregisterGymAgentsWebhook(
          { apiKey, companyId: gym.pushpress_company_id },
          gym.webhook_id
        )
        console.log(`[disconnect] Deactivated webhook ${gym.webhook_id}`)
      } catch (err: any) {
        console.warn('[disconnect] Failed to deactivate webhook:', err.message)
      }
    }

    await supabaseAdmin.from('autopilots').delete().eq('gym_id', gym.id)
    await supabaseAdmin.from('agent_runs').delete().eq('gym_id', gym.id)
    await supabaseAdmin.from('webhook_events').delete().eq('gym_id', gym.id)
    await supabaseAdmin.from('agent_subscriptions').delete().eq('gym_id', gym.id)
    await supabaseAdmin.from('gyms').delete().eq('id', gym.id)
  }

  return NextResponse.json({ success: true })
}
