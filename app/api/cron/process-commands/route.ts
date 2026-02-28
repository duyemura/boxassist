export const dynamic = 'force-dynamic'

/**
 * Vercel Cron endpoint — processes pending agent commands + autopilot tasks.
 *
 * Called every 60 seconds by Vercel Cron.
 * Validates CRON_SECRET header before processing.
 *
 * 1. Process pending commands from the command bus
 * 2. Auto-send messages for autopilot tasks that don't require approval
 * 3. Process follow-ups — any task past next_action_at (multi-touch sequences)
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
import { updateTaskStatus, appendConversation, getAutopilotSendCountToday, DAILY_AUTOPILOT_LIMIT } from '@/lib/db/tasks'
import { sendGmailMessage, isGmailConnected } from '@/lib/gmail'
import { evaluateFollowUp } from '@/lib/follow-up-evaluator'
import { Resend } from 'resend'
import { getAccountTimezone, isQuietHours } from '@/lib/timezone'

async function handler(req: NextRequest): Promise<NextResponse> {
  const resend = new Resend(process.env.RESEND_API_KEY!)
  // Validate CRON_SECRET — Vercel sends Authorization: Bearer <CRON_SECRET> on GET
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let commandResult: any = { processed: 0, failed: 0 }
  let autopilotSent = 0
  let autopilotSkipped = 0

  try {
    // 1. Process command bus
    const sendEmailExecutor = new SendEmailExecutor({
      mailer: { sendEmail: sendEmail as any },
      db: {
        createOutboundMessage: dbCommands.createOutboundMessage,
        updateOutboundMessageStatus: dbCommands.updateOutboundMessageStatus as any,
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

      // Respect quiet hours — don't send messages outside 8am-9pm local time
      const gymTimezone = await getAccountTimezone(task.gym_id)
      if (isQuietHours(gymTimezone)) {
        console.log(`[process-commands] Skipping autopilot for task ${task.id} — quiet hours in ${gymTimezone}`)
        continue
      }

      const ctx = (task.context ?? {}) as Record<string, unknown>
      const draftMessage = ctx.draftMessage as string
      const memberEmail = task.member_email
      const memberName = task.member_name ?? (memberEmail?.split('@')[0] ?? 'there')
      const messageSubject = (ctx.messageSubject as string) ?? 'Checking in from the gym'
      const accountName = gym.account_name ?? 'the gym'

      if (!draftMessage || !memberEmail) continue

      // Check opt-out list
      const { data: optout } = await supabaseAdmin
        .from('communication_optouts')
        .select('id')
        .eq('account_id', task.gym_id)
        .eq('channel', 'email')
        .eq('contact', memberEmail)
        .maybeSingle()

      if (optout) {
        console.log(`[process-commands] Skipping opted-out contact ${memberEmail} for task ${task.id}`)
        await updateTaskStatus(task.id, 'cancelled', {
          outcome: 'not_applicable',
          outcomeReason: 'Contact opted out of email',
        })
        autopilotSkipped++
        continue
      }

      // Check daily send limit using shared helper
      const todayCount = await getAutopilotSendCountToday(task.gym_id)
      if (todayCount >= DAILY_AUTOPILOT_LIMIT) {
        console.log(`[process-commands] Autopilot daily limit (${DAILY_AUTOPILOT_LIMIT}) reached for gym ${task.gym_id}`)
        break
      }

      try {
        // Send email — prefer Gmail if connected, fall back to Resend
        let providerId: string | undefined
        const htmlBody = `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #333;">
          ${draftMessage.split('\n').map((p: string) => `<p>${p}</p>`).join('')}
        </div>`

        const gmailAddress = await isGmailConnected(task.gym_id)
        if (gmailAddress) {
          const result = await sendGmailMessage({
            accountId: task.gym_id,
            to: memberEmail,
            subject: messageSubject,
            body: draftMessage,
          })
          providerId = result?.messageId ?? undefined
        } else {
          const result = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL!,
            replyTo: `reply+${task.id}@lunovoria.resend.app`,
            to: memberEmail,
            subject: messageSubject,
            html: htmlBody,
          })
          providerId = result?.data?.id ?? undefined
        }

        // Track in outbound_messages for audit trail
        try {
          await dbCommands.createOutboundMessage({
            account_id: task.gym_id,
            task_id: task.id,
            sent_by_agent: 'retention',
            channel: 'email',
            recipient_email: memberEmail,
            recipient_name: memberName,
            subject: messageSubject,
            body: draftMessage,
            reply_token: task.id,
            status: 'sent',
            provider: gmailAddress ? null : 'resend',
            provider_message_id: providerId ?? null,
          })
        } catch (err: any) {
          // Non-fatal — message was still sent
          console.warn(`[process-commands] Failed to log outbound_message for task ${task.id}:`, err?.message)
        }

        // Log conversation + update task status
        await appendConversation(task.id, {
          accountId: task.gym_id,
          role: 'agent',
          content: draftMessage,
          agentName: 'retention',
        })

        await updateTaskStatus(task.id, 'awaiting_reply')
        autopilotSent++

        console.log(`[process-commands] Autopilot sent to ${memberEmail} via ${gmailAddress ? 'gmail' : 'resend'} for task ${task.id}`)
      } catch (err: any) {
        console.error(`[process-commands] Autopilot send failed for task ${task.id}:`, err?.message)
      }
    }

    // 3. Process follow-ups — any task past next_action_at with no reply.
    //    The AI evaluates each task and decides: follow up, close, escalate, or wait.
    //    No hardcoded cadence logic — the skill file guides the AI's decision.
    let followUpsSent = 0
    let followUpsClosed = 0
    const { data: followUpTasks } = await supabaseAdmin
      .from('agent_tasks')
      .select('*')
      .eq('status', 'awaiting_reply')
      .not('next_action_at', 'is', null)
      .lt('next_action_at', new Date().toISOString())
      .limit(10)

    for (const task of followUpTasks ?? []) {
      const memberEmail = task.member_email
      if (!memberEmail) continue

      // Respect quiet hours — defer follow-ups outside 8am-9pm local time
      const followUpTimezone = await getAccountTimezone(task.gym_id)
      if (isQuietHours(followUpTimezone)) {
        console.log(`[process-commands] Deferring follow-up for task ${task.id} — quiet hours in ${followUpTimezone}`)
        continue
      }

      // Check opt-out (infrastructure — never AI-driven)
      const { data: optout } = await supabaseAdmin
        .from('communication_optouts')
        .select('id')
        .eq('account_id', task.gym_id)
        .eq('channel', 'email')
        .eq('contact', memberEmail)
        .maybeSingle()

      if (optout) {
        await updateTaskStatus(task.id, 'resolved', {
          outcome: 'not_applicable',
          outcomeReason: 'Contact opted out of email',
        })
        continue
      }

      // Gather context for the AI evaluator
      const { count: msgCount } = await supabaseAdmin
        .from('task_conversations')
        .select('*', { count: 'exact', head: true })
        .eq('task_id', task.id)
        .eq('role', 'agent')

      const { data: convoRows } = await supabaseAdmin
        .from('task_conversations')
        .select('role, content, created_at')
        .eq('task_id', task.id)
        .order('created_at', { ascending: true })

      const conversationHistory = (convoRows ?? [])
        .filter((r: any) => r.role === 'agent' || r.role === 'member')
        .map((r: any) => ({ role: r.role as 'agent' | 'member', content: r.content }))

      // Calculate days since last outbound message
      const lastAgentMsg = (convoRows ?? [])
        .filter((r: any) => r.role === 'agent')
        .pop()
      const daysSinceLastMessage = lastAgentMsg?.created_at
        ? Math.floor((Date.now() - new Date(lastAgentMsg.created_at).getTime()) / 86_400_000)
        : 0

      const taskCtx = (task.context ?? {}) as Record<string, unknown>

      // Ask the AI: should we follow up, close, escalate, or wait?
      const decision = await evaluateFollowUp({
        taskType: task.task_type ?? 'churn_risk',
        accountId: task.gym_id,
        memberName: task.member_name ?? 'there',
        memberEmail,
        conversationHistory,
        messagesSent: msgCount ?? 0,
        daysSinceLastMessage,
        accountName: (taskCtx.accountName as string) ?? undefined,
        memberContext: (taskCtx.detail as string) ?? (taskCtx.riskReason as string) ?? undefined,
      })

      // Execute the AI's decision — the cron is just infrastructure
      if (decision.action === 'close') {
        await updateTaskStatus(task.id, 'resolved', {
          outcome: decision.outcome ?? 'unresponsive',
          outcomeReason: decision.reason,
        })
        followUpsClosed++
        console.log(`[process-commands] AI closed task ${task.id}: ${decision.reason}`)

      } else if (decision.action === 'escalate') {
        await updateTaskStatus(task.id, 'escalated', {
          outcome: 'escalated',
          outcomeReason: decision.reason,
        })
        console.log(`[process-commands] AI escalated task ${task.id}: ${decision.reason}`)

      } else if (decision.action === 'wait') {
        const nextActionAt = new Date(Date.now() + (decision.nextCheckDays ?? 3) * 86_400_000)
        await updateTaskStatus(task.id, 'awaiting_reply', { nextActionAt })
        console.log(`[process-commands] AI decided to wait ${decision.nextCheckDays ?? 3}d for task ${task.id}: ${decision.reason}`)

      } else if (decision.action === 'follow_up' && decision.message) {
        try {
          // Send the AI-drafted follow-up via Gmail or Resend
          let providerId: string | undefined
          const gmailAddress = await isGmailConnected(task.gym_id)
          if (gmailAddress) {
            const result = await sendGmailMessage({
              accountId: task.gym_id,
              to: memberEmail,
              subject: 'Re: Checking in',
              body: decision.message,
            })
            providerId = result?.messageId ?? undefined
          } else {
            const result = await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL!,
              replyTo: `reply+${task.id}@lunovoria.resend.app`,
              to: memberEmail,
              subject: 'Re: Checking in',
              html: `<div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; color: #333;">
                <p>${decision.message}</p>
              </div>`,
            })
            providerId = result?.data?.id ?? undefined
          }

          // Track in outbound_messages
          try {
            await dbCommands.createOutboundMessage({
              account_id: task.gym_id,
              task_id: task.id,
              sent_by_agent: 'retention',
              channel: 'email',
              recipient_email: memberEmail,
              recipient_name: task.member_name ?? null,
              subject: 'Re: Checking in',
              body: decision.message,
              reply_token: task.id,
              status: 'sent',
              provider: gmailAddress ? null : 'resend',
              provider_message_id: providerId ?? null,
            })
          } catch (err: any) {
            console.warn(`[process-commands] Failed to log outbound_message for follow-up ${task.id}:`, err?.message)
          }

          await appendConversation(task.id, {
            accountId: task.gym_id,
            role: 'agent',
            content: decision.message,
            agentName: 'retention',
          })

          const nextActionAt = new Date(Date.now() + (decision.nextCheckDays ?? 7) * 86_400_000)
          await updateTaskStatus(task.id, 'awaiting_reply', { nextActionAt })

          followUpsSent++
          console.log(`[process-commands] Follow-up sent via ${gmailAddress ? 'gmail' : 'resend'} for task ${task.id}, next check in ${decision.nextCheckDays ?? 7}d`)
        } catch (err: any) {
          console.error(`[process-commands] Follow-up send failed for task ${task.id}:`, err?.message)
        }
      }
    }

    return NextResponse.json({ ...commandResult, autopilotSent, autopilotSkipped, followUpsSent, followUpsClosed, ok: true })
  } catch (err: any) {
    console.error('process-commands cron error:', err?.message)
    return NextResponse.json({ error: err?.message ?? 'internal error' }, { status: 500 })
  }
}

// Vercel Cron Jobs send GET requests — also keep POST for manual triggers
export const GET = handler
export const POST = handler
