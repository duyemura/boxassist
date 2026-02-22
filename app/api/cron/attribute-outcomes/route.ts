import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Get all pending actions within attribution window
  const { data: pending, error: pendingErr } = await supabaseAdmin
    .from('agent_run_actions')
    .select('*, gyms(pushpress_api_key, pushpress_company_id)')
    .eq('outcome', 'pending')
    .lt('attribution_expires_at', new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString())
    .gt('attribution_expires_at', new Date().toISOString())

  if (pendingErr) {
    console.error('Attribution fetch error:', pendingErr)
    return NextResponse.json({ error: pendingErr.message }, { status: 500 })
  }

  if (!pending?.length) return NextResponse.json({ checked: 0, attributed: 0 })

  let attributed = 0

  for (const action of pending) {
    const gym = (action as any).gyms
    if (!gym?.pushpress_api_key) continue

    try {
      // Check if member checked in since action was created
      const checkinRes = await fetch(
        `https://api.pushpress.com/v3/checkins?company_id=${gym.pushpress_company_id}&client_id=${action.member_id}&after=${action.created_at}&limit=1`,
        { headers: { 'x-api-key': gym.pushpress_api_key } }
      )
      const checkins = await checkinRes.json()

      const hasCheckin =
        (checkins?.data?.length > 0) ||
        (Array.isArray(checkins) && checkins.length > 0)

      if (hasCheckin) {
        // Member came back! Attribute success.
        const membershipValue = 130 // TODO: pull from gym settings
        await supabaseAdmin
          .from('agent_run_actions')
          .update({
            outcome: 'checkin',
            outcome_at: checkins.data?.[0]?.created_at ?? new Date().toISOString(),
            actual_value_usd: membershipValue,
          })
          .eq('id', action.id)
        attributed++
      } else if (new Date(action.attribution_expires_at) < new Date()) {
        // Window expired, no outcome
        await supabaseAdmin
          .from('agent_run_actions')
          .update({ outcome: 'no_outcome' })
          .eq('id', action.id)
      }
    } catch (e) {
      console.error('Attribution check failed for action', action.id, e)
    }
  }

  // Update aggregate attributed_value on each affected run
  const { data: attributedActions } = await supabaseAdmin
    .from('agent_run_actions')
    .select('run_id, actual_value_usd')
    .eq('outcome', 'checkin')

  if (attributedActions?.length) {
    const byRun: Record<string, number> = {}
    for (const r of attributedActions) {
      byRun[r.run_id] = (byRun[r.run_id] ?? 0) + (r.actual_value_usd ?? 0)
    }
    for (const [runId, value] of Object.entries(byRun)) {
      await supabaseAdmin
        .from('agent_runs')
        .update({ attributed_value_usd: value, outcome_status: 'attributed' })
        .eq('id', runId)
    }
  }

  return NextResponse.json({ checked: pending.length, attributed })
}
