import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Attribution cron — checks agent_tasks for member re-engagement.
 *
 * For tasks with status in ('resolved', 'awaiting_reply') and no outcome yet:
 * - Check PushPress checkins API for that member since task creation
 * - If checkin found: outcome='engaged', attributed_value = gym's avg membership price
 * - If 14-day window expired with no checkin and no reply: outcome='unresponsive'
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Get tasks that need attribution checking
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: tasks, error: tasksError } = await supabaseAdmin
    .from('agent_tasks')
    .select('*, gyms(pushpress_api_key, pushpress_company_id, avg_membership_price)')
    .in('status', ['resolved', 'awaiting_reply'])
    .is('outcome', null)
    .not('member_email', 'is', null)
    .gte('created_at', fourteenDaysAgo)

  if (tasksError) {
    console.error('[attribute-outcomes] Fetch error:', tasksError)
    return NextResponse.json({ error: tasksError.message }, { status: 500 })
  }

  if (!tasks?.length) return NextResponse.json({ checked: 0, attributed: 0, expired: 0 })

  let attributed = 0
  let expired = 0

  for (const task of tasks) {
    const gym = (task as any).gyms
    if (!gym?.pushpress_api_key) continue

    const taskCreatedAt = new Date(task.created_at)
    const windowExpired = Date.now() - taskCreatedAt.getTime() > 14 * 24 * 60 * 60 * 1000

    try {
      // Check if member checked in since task was created
      const checkinRes = await fetch(
        `https://api.pushpress.com/v3/checkins?company_id=${gym.pushpress_company_id}&client_id=${task.member_id ?? ''}&after=${task.created_at}&limit=1`,
        { headers: { 'API-KEY': gym.pushpress_api_key } }
      )
      const checkins = await checkinRes.json()

      const hasCheckin =
        (checkins?.data?.length > 0) ||
        (Array.isArray(checkins) && checkins.length > 0)

      if (hasCheckin) {
        const membershipValue = gym.avg_membership_price ?? 150
        await supabaseAdmin
          .from('agent_tasks')
          .update({
            outcome: 'engaged',
            outcome_reason: 'checkin_after_outreach',
            outcome_score: 80,
            attributed_value: membershipValue,
            attributed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.id)
        attributed++
      } else if (windowExpired) {
        await supabaseAdmin
          .from('agent_tasks')
          .update({
            outcome: 'unresponsive',
            outcome_reason: 'no_checkin_within_attribution_window',
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.id)
        expired++
      }
    } catch (e) {
      console.error('[attribute-outcomes] Check failed for task', task.id, e)
    }
  }

  console.log(`[attribute-outcomes] checked=${tasks.length} attributed=${attributed} expired=${expired}`)

  return NextResponse.json({ checked: tasks.length, attributed, expired })
}

export const POST = GET
