/**
 * Vercel Cron endpoint — processes pending agent commands + autopilot tasks.
 *
 * Called every 60 seconds by Vercel Cron.
 * Validates CRON_SECRET header before processing.
 *
 * 1. Process pending commands from the command bus
 * 2. Auto-send messages for autopilot tasks that don't require approval
 *
 * vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/process-commands", "schedule": "* * * * *" }]
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { CommandBus } from '@/lib/commands/commandBus'
import * as dbCommands from '@/lib/db/commands'
import { SendEmailExecutor } from '@/lib/commands/executors/sendEmailExecutor'
import { sendEmail } from '@/lib/resend'
import { supabaseAdmin } from '@/lib/supabase'
import { updateTaskStatus, appendConversation } from '@/lib/db/tasks'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

const DAILY_AUTOPILOT_LIMIT = 10

async function handler(req: NextRequest): Promise<NextResponse> {
  // Validate CRON_SECRET — Vercel sends Authorization: Bearer <CRON_SECRET> on GET
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let commandResult: any = { processed: 0, failed: 0 }
  let autopilotSent = 0

  try {
    // 1. Process command bus
    const sendEmailExecutor = new SendEmailExecutor({
      mailer: { sendEmail },
      db: {
        createOutboundMessage: dbCommands.createOutboundMessage,
        updateOutboundMessageStatus: dbCommands.updateOutboundMessageStatus,
      },
    })

    const bus = new CommandBus({
      db: {
        insertCommand: dbCommands.insertCommand,
        claimPendingCommands: dbCommands.claimPendingCommands,
        completeCommand: dbCommands.completeCommand,
        failCommand: dbCommands.failCommand,
        deadLetterCommand: dbCommands.deadLetterCommand,
      },
      executors: {
        SendEmail: sendEmailExecutor,
      },
    })

    commandResult = await bus.processNext(20)

    // 2. Process autopilot tasks — send messages for tasks that don't require approval
    const { data: autopilotTasks } = await supabaseAdmin
      .from('agent_tasks')
      .select('*, gyms(autopilot_enabled, gym_name)')
      .eq('requires_approval', false)
      .eq('status', 'open')
      .not('member_email', 'is', null)
      .limit(20)

    for (const task of autopilotTasks ?? []) {
      const gym = (task as any).gyms
      if (!gym?.autopilot_enabled) continue

      const ctx = (task.context ?? {}) as Record<string, unknown>
      const draftMessage = ctx.draftMessage as string
      const memberEmail = task.member_email
      const messageSubject = (ctx.messageSubject as string) ?? 'Checking in from the gym'

      if (!draftMessage || !memberEmail) continue

      // Check daily send limit
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { count } = await supabaseAdmin
        .from('task_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('gym_id', task.gym_id)
        .eq('role', 'agent')
        .gte('created_at', todayStart.toISOString())

      if ((count ?? 0) >= DAILY_AUTOPILOT_LIMIT) {
        console.log(`[process-commands] Autopilot daily limit reached for gym ${task.gym_id}`)
        continue
      }

      try {
        // Send email
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          replyTo: `reply+${task.id}@lunovoria.resend.app`,
          to: memberEmail,
          subject: messageSubject,
          html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #333;">
            ${draftMessage.split('\n').map((p: string) => `<p>${p}</p>`).join('')}
          </div>`
        })

        // Log conversation + update task status
        await appendConversation(task.id, {
          gymId: task.gym_id,
          role: 'agent',
          content: draftMessage,
          agentName: 'retention',
        })

        await updateTaskStatus(task.id, 'awaiting_reply')
        autopilotSent++

        console.log(`[process-commands] Autopilot sent to ${memberEmail} for task ${task.id}`)
      } catch (err: any) {
        console.error(`[process-commands] Autopilot send failed for task ${task.id}:`, err?.message)
      }
    }

    // 3. Process win-back follow-ups — tasks past next_action_at with no reply
    let followUpsSent = 0
    const { data: followUpTasks } = await supabaseAdmin
      .from('agent_tasks')
      .select('*')
      .eq('status', 'awaiting_reply')
      .eq('task_type', 'win_back')
      .not('next_action_at', 'is', null)
      .lt('next_action_at', new Date().toISOString())
      .limit(10)

    for (const task of followUpTasks ?? []) {
      const ctx = (task.context ?? {}) as Record<string, unknown>
      const memberEmail = task.member_email
      if (!memberEmail) continue

      // Determine follow-up touch number from conversation count
      const { count: msgCount } = await supabaseAdmin
        .from('task_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('task_id', task.id)
        .eq('role', 'agent')

      const touchNumber = (msgCount ?? 0) + 1

      if (touchNumber >= 4) {
        // Touch 3 was the last — close as churned
        await updateTaskStatus(task.id, 'resolved', {
          outcome: 'churned',
          outcomeReason: 'No response after 3 win-back touches',
        })
        console.log(`[process-commands] Win-back closed as churned: task ${task.id}`)
        continue
      }

      // Set next follow-up timing
      // Touch 1: immediate (already sent), Touch 2: day 3, Touch 3: day 10
      const nextDays = touchNumber === 2 ? 7 : 0 // Touch 2→3 is 7 more days
      const nextActionAt = nextDays > 0
        ? new Date(Date.now() + nextDays * 24 * 60 * 60 * 1000)
        : undefined

      const followUpMessage = touchNumber === 2
        ? `Hey ${task.member_name?.split(' ')[0] ?? 'there'}, I know things change and that's OK. If there's anything we could do differently, I'd love to hear it. No pressure at all.`
        : `Hey ${task.member_name?.split(' ')[0] ?? 'there'}, just wanted you to know the door's always open. If you ever want to come back, we'll be here. Wishing you the best.`

      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          replyTo: `reply+${task.id}@lunovoria.resend.app`,
          to: memberEmail,
          subject: 'Re: Checking in',
          html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #333;">
            <p>${followUpMessage}</p>
          </div>`
        })

        await appendConversation(task.id, {
          gymId: task.gym_id,
          role: 'agent',
          content: followUpMessage,
          agentName: 'retention',
        })

        if (nextActionAt) {
          await updateTaskStatus(task.id, 'awaiting_reply', { nextActionAt })
        }

        followUpsSent++
        console.log(`[process-commands] Win-back follow-up #${touchNumber} sent for task ${task.id}`)
      } catch (err: any) {
        console.error(`[process-commands] Win-back follow-up failed for task ${task.id}:`, err?.message)
      }
    }

    return NextResponse.json({ ...commandResult, autopilotSent, followUpsSent, ok: true })
  } catch (err: any) {
    console.error('process-commands cron error:', err?.message)
    return NextResponse.json({ error: err?.message ?? 'internal error' }, { status: 500 })
  }
}

// Vercel Cron Jobs send GET requests — also keep POST for manual triggers
export const GET = handler
export const POST = handler
