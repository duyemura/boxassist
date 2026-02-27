/**
 * Action tools — tools that produce side effects.
 *
 * Approval requirements vary by tool and autonomy mode:
 * - create_task, close_task, escalate, notify_owner: never pause (reversible or notification)
 * - draft_message: never pauses (no side effect)
 * - send_email: pauses in semi_auto and turn_based
 * - request_input: pauses in semi_auto and turn_based, auto-responds in full_auto
 * - wait_for_reply: always pauses (waiting for external event)
 */

import { v4 as uuidv4 } from 'uuid'
import type { AgentTool, ToolGroup, ToolContext } from './types'
import { createTask } from '../../db/tasks'
import { updateTaskStatus } from '../../db/tasks'
import { supabaseAdmin } from '../../supabase'

// ── create_task ─────────────────────────────────────────────────────────

const createTaskTool: AgentTool = {
  name: 'create_task',
  description: 'Create a tracked task for a member. Tasks are the unit of work — they track outreach, follow-ups, and outcomes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      task_type: { type: 'string', description: 'Type label (e.g. churn_risk, lead_followup, payment_recovery).' },
      member_email: { type: 'string', description: 'Member email address.' },
      member_name: { type: 'string', description: 'Member name.' },
      goal: { type: 'string', description: 'What this task should accomplish.' },
      priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Task priority.' },
    },
    required: ['task_type', 'goal'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    try {
      const task = await createTask({
        accountId: ctx.accountId,
        assignedAgent: 'retention',
        taskType: input.task_type as string,
        memberEmail: input.member_email as string | undefined,
        memberName: input.member_name as string | undefined,
        goal: input.goal as string,
        context: {
          priority: input.priority ?? 'medium',
          sessionId: ctx.sessionId,
        },
      })

      // Track in working set
      if (input.member_email) {
        const memberId = (input as any).member_id
        if (memberId) ctx.workingSet.processed.push(memberId)
      }

      return { taskId: task.id, status: 'created' }
    } catch (err: any) {
      return { error: `Failed to create task: ${err.message}` }
    }
  },
}

// ── draft_message ───────────────────────────────────────────────────────

const draftMessage: AgentTool = {
  name: 'draft_message',
  description: 'Draft a message without sending it. Returns the draft for the owner to review. No side effects.',
  input_schema: {
    type: 'object' as const,
    properties: {
      to_name: { type: 'string', description: 'Recipient name.' },
      to_email: { type: 'string', description: 'Recipient email.' },
      subject: { type: 'string', description: 'Email subject line.' },
      body: { type: 'string', description: 'Email body text.' },
      context: { type: 'string', description: 'Why this message is being sent.' },
    },
    required: ['to_email', 'subject', 'body'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>) {
    return {
      draft: {
        to: input.to_email,
        toName: input.to_name ?? null,
        subject: input.subject,
        body: input.body,
        context: input.context ?? null,
      },
      status: 'drafted',
      note: 'This is a draft only. Use send_email to actually send it.',
    }
  },
}

// ── send_email ──────────────────────────────────────────────────────────

const sendEmail: AgentTool = {
  name: 'send_email',
  description: 'Send an email to anyone (member or external person). Includes reply tracking. Pauses for approval in semi_auto mode.',
  input_schema: {
    type: 'object' as const,
    properties: {
      to_email: { type: 'string', description: 'Recipient email address.' },
      to_name: { type: 'string', description: 'Recipient name.' },
      subject: { type: 'string', description: 'Email subject line.' },
      body: { type: 'string', description: 'Email body text. Plain text, warm and personal.' },
      task_id: { type: 'string', description: 'Optional task ID to link this email to.' },
    },
    required: ['to_email', 'subject', 'body'],
  },
  // Approval depends on mode — non-reversible action
  requiresApproval: (_input, ctx) => {
    return ctx.autonomyMode !== 'full_auto'
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    const toEmail = input.to_email as string
    const replyToken = uuidv4()

    try {
      // Safety: check daily send limit
      const { count } = await supabaseAdmin
        .from('outbound_messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())

      if ((count ?? 0) >= 10) {
        return { error: 'Daily send limit reached (10 messages). Try again tomorrow.' }
      }

      // Safety: check opt-out
      const { data: optout } = await supabaseAdmin
        .from('communication_optouts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('channel', 'email')
        .eq('contact', toEmail)
        .maybeSingle()

      if (optout) {
        return { error: `${toEmail} has opted out of email communication.` }
      }

      // Safety: check double-send for same task
      if (input.task_id) {
        const { data: existing } = await supabaseAdmin
          .from('outbound_messages')
          .select('id')
          .eq('account_id', ctx.accountId)
          .eq('task_id', input.task_id as string)
          .eq('recipient_email', toEmail)
          .maybeSingle()

        if (existing) {
          return { error: `Already sent an email to ${toEmail} for this task. Skipping duplicate.` }
        }
      }

      // Create outbound message record
      const { data: msg, error: msgError } = await supabaseAdmin
        .from('outbound_messages')
        .insert({
          account_id: ctx.accountId,
          task_id: input.task_id ?? null,
          sent_by_agent: 'session',
          channel: 'email',
          recipient_email: toEmail,
          recipient_name: input.to_name ?? null,
          subject: input.subject,
          body: input.body,
          reply_token: replyToken,
          status: 'queued',
          session_id: ctx.sessionId,
        })
        .select('id')
        .single()

      if (msgError) {
        return { error: `Failed to queue email: ${msgError.message}` }
      }

      // Queue SendEmail command
      const { insertCommand } = await import('../../db/commands')
      await insertCommand({
        accountId: ctx.accountId,
        type: 'SendEmail',
        payload: {
          outboundMessageId: msg.id,
          to: toEmail,
          toName: input.to_name ?? null,
          subject: input.subject,
          body: input.body,
          replyToken: replyToken,
        },
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      })

      // Track in working set
      ctx.workingSet.emailed.push(toEmail)

      return {
        messageId: msg.id,
        replyToken,
        status: 'queued',
        note: `Email queued to ${toEmail}. Reply token: ${replyToken}`,
      }
    } catch (err: any) {
      return { error: `Failed to send email: ${err.message}` }
    }
  },
}

// ── wait_for_reply ──────────────────────────────────────────────────────

const waitForReply: AgentTool = {
  name: 'wait_for_reply',
  description: 'Pause this session until a reply arrives on a specific reply token. The session will automatically resume when the reply comes in. Use this after sending an email when you need to wait for a response.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply_token: { type: 'string', description: 'The reply token from a previous send_email call.' },
      reason: { type: 'string', description: 'Why we\'re waiting (shown to the owner).' },
    },
    required: ['reply_token'],
  },
  // Always pauses — there's nothing to do until the reply arrives
  requiresApproval: true,
  async execute(input: Record<string, unknown>) {
    // This tool's execution is special — the runtime intercepts it
    // to set session status to 'waiting_event' instead of actually "executing"
    return {
      status: 'waiting',
      replyToken: input.reply_token,
      reason: input.reason ?? 'Waiting for email reply',
      note: 'Session will resume automatically when a reply arrives.',
    }
  },
}

// ── notify_owner ────────────────────────────────────────────────────────

const notifyOwner: AgentTool = {
  name: 'notify_owner',
  description: 'Send a notification to the business owner. Use this to alert them about something important, share a finding, or request their attention.',
  input_schema: {
    type: 'object' as const,
    properties: {
      message: { type: 'string', description: 'The notification message.' },
      urgency: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How urgent this notification is.' },
    },
    required: ['message'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    try {
      // Store notification as a system event
      const { data, error } = await supabaseAdmin
        .from('gm_chat')
        .insert({
          account_id: ctx.accountId,
          role: 'assistant',
          content: `[Agent Notification] ${input.message}`,
        })
        .select('id')
        .single()

      if (error) {
        return { error: `Failed to create notification: ${error.message}` }
      }

      return { notificationId: data.id, status: 'sent' }
    } catch (err: any) {
      return { error: `Failed to notify owner: ${err.message}` }
    }
  },
}

// ── close_task ──────────────────────────────────────────────────────────

const closeTask: AgentTool = {
  name: 'close_task',
  description: 'Mark a task as resolved with an outcome.',
  input_schema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'The task ID to close.' },
      outcome: {
        type: 'string',
        enum: ['converted', 'recovered', 'engaged', 'unresponsive', 'churned', 'escalated', 'not_applicable'],
        description: 'Outcome of the task.',
      },
      reason: { type: 'string', description: 'Brief explanation of the outcome.' },
    },
    required: ['task_id', 'outcome'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>) {
    try {
      await updateTaskStatus(input.task_id as string, 'resolved', {
        outcome: input.outcome as any,
        outcomeReason: input.reason as string | undefined,
      })
      return { taskId: input.task_id, status: 'resolved', outcome: input.outcome }
    } catch (err: any) {
      return { error: `Failed to close task: ${err.message}` }
    }
  },
}

// ── escalate ────────────────────────────────────────────────────────────

const escalate: AgentTool = {
  name: 'escalate',
  description: 'Escalate a situation to the owner. Use when the situation needs human judgment — complaints, billing questions, cancellation requests, injury mentions, legal threats.',
  input_schema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Optional task ID to escalate.' },
      reason: { type: 'string', description: 'Why this needs owner attention.' },
      member_name: { type: 'string', description: 'Who this is about.' },
      suggested_action: { type: 'string', description: 'What you recommend the owner do.' },
    },
    required: ['reason'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    try {
      if (input.task_id) {
        await updateTaskStatus(input.task_id as string, 'escalated', {
          outcomeReason: input.reason as string,
        })
      }

      // Create escalation notification
      await supabaseAdmin
        .from('gm_chat')
        .insert({
          account_id: ctx.accountId,
          role: 'assistant',
          content: `[ESCALATION] ${input.reason}${input.member_name ? ` (Re: ${input.member_name})` : ''}${input.suggested_action ? `\n\nSuggested action: ${input.suggested_action}` : ''}`,
        })

      return {
        status: 'escalated',
        taskId: input.task_id ?? null,
        note: 'Escalated to owner. They will be notified.',
      }
    } catch (err: any) {
      return { error: `Failed to escalate: ${err.message}` }
    }
  },
}

// ── request_input ───────────────────────────────────────────────────────

const requestInput: AgentTool = {
  name: 'request_input',
  description: 'Ask the owner a question. In full_auto mode, this returns "make your best judgment" so you keep going. In semi_auto/turn_based, this pauses for the owner to respond.',
  input_schema: {
    type: 'object' as const,
    properties: {
      question: { type: 'string', description: 'The question to ask the owner.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional predefined answer choices.',
      },
    },
    required: ['question'],
  },
  // Approval depends on mode
  requiresApproval: (_input, ctx) => {
    // In full_auto, request_input auto-responds — no pause
    return ctx.autonomyMode !== 'full_auto'
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    // In full_auto, auto-respond
    if (ctx.autonomyMode === 'full_auto') {
      return { answer: 'You are in full auto mode. Make your best judgment.' }
    }

    // In other modes, the runtime will pause before reaching here
    // If we DO get here, it means the owner approved — return their response
    return {
      status: 'awaiting_input',
      question: input.question,
      options: input.options ?? null,
    }
  },
}

// ── Tool group ──────────────────────────────────────────────────────────

export const actionToolGroup: ToolGroup = {
  name: 'action',
  tools: [createTaskTool, draftMessage, sendEmail, waitForReply, notifyOwner, closeTask, escalate, requestInput],
}
