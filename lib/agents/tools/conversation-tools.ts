/**
 * Conversation tools — tools for reading and replying to conversations.
 *
 * These tools are used by role-based agents (Front Desk, GM) that operate
 * on conversations rather than tasks. They provide:
 *
 * - get_conversation_history: load the message thread
 * - send_reply: send a reply through the appropriate channel and record it
 *
 * The send_reply tool handles channel routing (email, SMS, etc.),
 * safety checks (opt-out, rate limits), and conversation recording.
 */

import { v4 as uuidv4 } from 'uuid'
import type { AgentTool, ToolGroup, ToolContext } from './types'
import {
  getConversationMessages,
  getConversation,
  addMessage,
  reassignConversation,
} from '../../db/conversations'
import { supabaseAdmin } from '../../supabase'

// ── get_conversation_history ─────────────────────────────────────────────

const getConversationHistory: AgentTool = {
  name: 'get_conversation_history',
  description: 'Load the message history for the current conversation. Returns messages in chronological order with direction (inbound/outbound), sender, and channel.',
  input_schema: {
    type: 'object' as const,
    properties: {
      conversation_id: { type: 'string', description: 'Conversation ID to load history for.' },
      limit: { type: 'number', description: 'Max messages to return (default 50).' },
    },
    required: ['conversation_id'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>) {
    const conversationId = input.conversation_id as string
    const limit = (input.limit as number) ?? 50

    try {
      const messages = await getConversationMessages(conversationId, { limit })
      return {
        count: messages.length,
        messages: messages.map(m => ({
          direction: m.direction,
          channel: m.channel,
          sender: m.sender,
          content: m.content,
          timestamp: m.createdAt,
        })),
      }
    } catch (err: any) {
      return { error: `Failed to load conversation: ${err.message}` }
    }
  },
}

// ── send_reply ───────────────────────────────────────────────────────────

const sendReply: AgentTool = {
  name: 'send_reply',
  description: 'Send a reply in a conversation. Handles channel routing (email, SMS), safety checks (opt-out, rate limits), and records the message in the conversation thread. Use this instead of send_email when replying in a conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      conversation_id: { type: 'string', description: 'Conversation to reply in.' },
      content: { type: 'string', description: 'Reply message content. Plain text, warm and personal.' },
      subject: { type: 'string', description: 'Email subject (for email channel only). Omit to use existing thread subject.' },
      channel_override: { type: 'string', description: 'Override channel (email, sms). Defaults to conversation\'s primary channel.' },
    },
    required: ['conversation_id', 'content'],
  },
  requiresApproval: (_input, ctx) => {
    return ctx.autonomyMode !== 'full_auto'
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext) {
    const conversationId = input.conversation_id as string
    const content = input.content as string

    try {
      // Load conversation to get contact info and channel
      const conversation = await getConversation(conversationId)
      if (!conversation) {
        return { error: `Conversation ${conversationId} not found` }
      }

      const channel = (input.channel_override as string) ?? conversation.channel

      // Safety: check opt-out
      const contactField = channel === 'email' ? conversation.contactEmail : conversation.contactPhone
      if (contactField) {
        const { data: optout } = await supabaseAdmin
          .from('communication_optouts')
          .select('id')
          .eq('account_id', ctx.accountId)
          .eq('channel', channel)
          .eq('contact', contactField)
          .maybeSingle()

        if (optout) {
          return { error: `Contact has opted out of ${channel} communication.` }
        }
      }

      // Safety: check daily send limit
      const { count } = await supabaseAdmin
        .from('outbound_messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())

      if ((count ?? 0) >= 10) {
        return { error: 'Daily send limit reached (10 messages). Try again tomorrow.' }
      }

      // Dispatch by channel
      let sendResult: { messageId: string; status: string }

      if (channel === 'email') {
        sendResult = await sendEmailReply(ctx, conversation, content, input.subject as string | undefined)
      } else if (channel === 'sms') {
        sendResult = await sendSmsReply(ctx, conversation, content)
      } else {
        return { error: `Channel ${channel} is not yet supported for outbound messages.` }
      }

      // Record outbound message in conversation thread
      await addMessage({
        conversationId,
        direction: 'outbound',
        channel,
        content,
        sender: 'front_desk',
        externalId: sendResult.messageId,
      })

      return {
        status: sendResult.status,
        messageId: sendResult.messageId,
        channel,
        conversationId,
      }
    } catch (err: any) {
      return { error: `Failed to send reply: ${err.message}` }
    }
  },
}

// ── Channel-specific send helpers ────────────────────────────────────────

async function sendEmailReply(
  ctx: ToolContext,
  conversation: { contactEmail: string | null; contactName: string | null; subject: string | null; id: string },
  content: string,
  subjectOverride?: string,
): Promise<{ messageId: string; status: string }> {
  const toEmail = conversation.contactEmail
  if (!toEmail) {
    throw new Error('No email address for this contact')
  }

  const replyToken = uuidv4()
  const subject = subjectOverride ?? conversation.subject ?? 'Re: Your message'

  // Create outbound message record
  const { data: msg, error: msgError } = await supabaseAdmin
    .from('outbound_messages')
    .insert({
      account_id: ctx.accountId,
      sent_by_agent: 'front_desk',
      channel: 'email',
      recipient_email: toEmail,
      recipient_name: conversation.contactName,
      subject,
      body: content,
      reply_token: replyToken,
      status: 'queued',
      session_id: ctx.sessionId,
      conversation_id: conversation.id,
    })
    .select('id')
    .single()

  if (msgError) {
    throw new Error(`Failed to queue email: ${msgError.message}`)
  }

  // Queue SendEmail command
  const { insertCommand } = await import('../../db/commands')
  await insertCommand({
    accountId: ctx.accountId,
    commandType: 'SendEmail',
    payload: {
      outboundMessageId: msg.id,
      to: toEmail,
      toName: conversation.contactName,
      subject,
      body: content,
      replyToken,
    },
    issuedByAgent: 'front_desk',
    status: 'pending',
  })

  return { messageId: msg.id, status: 'queued' }
}

async function sendSmsReply(
  ctx: ToolContext,
  conversation: { contactPhone: string | null; contactName: string | null; id: string },
  content: string,
): Promise<{ messageId: string; status: string }> {
  const toPhone = conversation.contactPhone
  if (!toPhone) {
    throw new Error('No phone number for this contact')
  }

  // Create outbound message record
  const { data: msg, error: msgError } = await supabaseAdmin
    .from('outbound_messages')
    .insert({
      account_id: ctx.accountId,
      sent_by_agent: 'front_desk',
      channel: 'sms',
      recipient_phone: toPhone,
      recipient_name: conversation.contactName,
      body: content,
      status: 'queued',
      session_id: ctx.sessionId,
      conversation_id: conversation.id,
    })
    .select('id')
    .single()

  if (msgError) {
    throw new Error(`Failed to queue SMS: ${msgError.message}`)
  }

  // Queue SendSMS command
  const { insertCommand } = await import('../../db/commands')
  await insertCommand({
    accountId: ctx.accountId,
    commandType: 'SendSMS',
    payload: {
      outboundMessageId: msg.id,
      to: toPhone,
      toName: conversation.contactName,
      body: content,
    },
    issuedByAgent: 'front_desk',
    status: 'pending',
  })

  return { messageId: msg.id, status: 'queued' }
}

// ── escalate_conversation ─────────────────────────────────────────────

const escalateConversation: AgentTool = {
  name: 'escalate_conversation',
  description: 'Escalate a conversation to the GM. Use this when the situation is beyond your authority — cancellation requests, refund disputes, complaints about staff, legal mentions, or anything you are unsure about. The GM will pick up the conversation with full history.',
  input_schema: {
    type: 'object' as const,
    properties: {
      conversation_id: { type: 'string', description: 'Conversation ID to escalate.' },
      reason: { type: 'string', description: 'Why you are escalating — be specific about what triggered it and any relevant context.' },
    },
    required: ['conversation_id', 'reason'],
  },
  requiresApproval: false,
  async execute(input: Record<string, unknown>) {
    const conversationId = input.conversation_id as string
    const reason = input.reason as string

    try {
      // Reassign conversation to GM with escalated status
      await reassignConversation(conversationId, 'gm', 'escalated')

      return {
        escalated: true,
        conversationId,
        newRole: 'gm',
        reason,
      }
    } catch (err: any) {
      return { error: `Failed to escalate: ${err.message}` }
    }
  },
}

// ── Export tool group ────────────────────────────────────────────────────

export const conversationToolGroup: ToolGroup = {
  name: 'conversation',
  tools: [getConversationHistory, sendReply, escalateConversation],
}
