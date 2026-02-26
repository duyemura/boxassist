export const dynamic = 'force-dynamic'

/**
 * POST /api/cron/daily-digest
 *
 * Sends daily email digest to gym owners with activity summary.
 * Called once daily by Vercel Cron (e.g., 8am local time).
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { getMonthlyRetentionROI } from '@/lib/db/kpi'


async function handler(req: NextRequest): Promise<NextResponse> {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all accounts with connected owners via team_members
  const { data: members } = await supabaseAdmin
    .from('team_members')
    .select('user_id, accounts!inner(id, account_name, pushpress_api_key), users(email)')
    .eq('role', 'owner')
    .not('accounts.pushpress_api_key', 'is', null)

  let sent = 0

  for (const member of members ?? []) {
    const account = (member as any).accounts
    const ownerEmail = (member as any).users?.email
    if (!ownerEmail || !account) continue

    try {
      // Get today's pending tasks
      const { data: pendingTasks } = await supabaseAdmin
        .from('agent_tasks')
        .select('id, member_name, status')
        .eq('account_id', account.id)
        .in('status', ['open', 'awaiting_approval', 'escalated'])

      const pendingCount = pendingTasks?.length ?? 0
      const escalatedCount = pendingTasks?.filter(t => t.status === 'escalated').length ?? 0

      // Don't send if nothing to report
      if (pendingCount === 0) continue

      // Get monthly stats
      const roi = await getMonthlyRetentionROI(account.id)

      const memberNames = (pendingTasks ?? [])
        .slice(0, 3)
        .map(t => t.member_name ?? 'A member')
        .join(', ')

      const subject = escalatedCount > 0
        ? `${escalatedCount} escalation${escalatedCount !== 1 ? 's' : ''} + ${pendingCount} members need attention`
        : `${pendingCount} member${pendingCount !== 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} attention`

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: ownerEmail,
        subject: `GymAgents: ${subject}`,
        html: `<div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px; color: #333;">
          <div style="border-bottom: 2px solid #0063FF; padding-bottom: 16px; margin-bottom: 24px;">
            <span style="font-weight: 700; font-size: 14px;">GymAgents</span>
            <span style="color: #9CA3AF;"> &middot; ${account.account_name ?? 'Your Gym'}</span>
          </div>

          <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 8px; color: #080808;">
            ${subject}
          </h2>

          <p style="font-size: 14px; line-height: 1.6; color: #374151; margin: 0 0 24px;">
            ${memberNames}${pendingCount > 3 ? ` and ${pendingCount - 3} more` : ''} — your agents have drafted messages ready for review.
          </p>

          ${roi.membersRetained > 0 ? `
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; padding: 16px; margin-bottom: 24px;">
            <p style="font-size: 12px; font-weight: 600; color: #16A34A; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em;">
              THIS MONTH
            </p>
            <p style="font-size: 18px; font-weight: 600; color: #16A34A; margin: 0;">
              ${roi.membersRetained} retained &middot; $${roi.revenueRetained.toLocaleString()} saved
            </p>
          </div>
          ` : ''}

          <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app-orcin-one-70.vercel.app'}/dashboard"
             style="display: inline-block; background: #0063FF; color: white; font-size: 14px; font-weight: 600; padding: 10px 24px; text-decoration: none;">
            Review &amp; Approve &rarr;
          </a>

          <p style="font-size: 11px; color: #9CA3AF; margin-top: 32px;">
            You're receiving this because you have GymAgents connected to ${gym.account_name ?? 'your gym'}.
          </p>
        </div>`,
      })

      sent++
    } catch (err: any) {
      console.error(`[daily-digest] Failed for gym ${account.id}:`, err?.message)
    }
  }

  console.log(`[daily-digest] Sent ${sent} digests`)
  return NextResponse.json({ ok: true, sent })
}

export const GET = handler
export const POST = handler
