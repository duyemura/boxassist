/**
 * Channel router — routes inbound messages to the correct conversation and agent.
 *
 * Any channel (email, SMS, WhatsApp, Instagram, voice, chat) calls routeInbound().
 * The router:
 *   1. Identifies the contact (by email, phone, or external ID)
 *   2. Finds or creates a conversation
 *   3. Adds the message to the conversation thread
 *   4. Returns routing info so the caller can start/resume an agent session
 *
 * The router does NOT start agent sessions — that's the caller's job.
 * This keeps the router testable and lets different webhooks handle sessions differently.
 */

import {
  findOpenConversation,
  createConversation,
  addMessage,
  getConversation,
  type Conversation,
  type ConversationMessage,
} from './db/conversations'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InboundMessage {
  accountId: string
  channel: string                // email, sms, whatsapp, instagram, facebook, voice, chat
  content: string
  contactId: string              // member/lead ID from connector
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  externalId?: string            // provider message ID (Resend email ID, Twilio SID, etc.)
  subject?: string               // email subject
  metadata?: Record<string, unknown>
}

export interface RouteResult {
  conversation: Conversation
  message: ConversationMessage
  isNew: boolean                 // true if a new conversation was created
  assignedRole: string           // which role should handle this
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Route an inbound message to the correct conversation and role.
 *
 * Returns the conversation and message so the caller can decide
 * whether to start a new agent session or resume an existing one.
 */
export async function routeInbound(msg: InboundMessage): Promise<RouteResult> {
  // 1. Find an existing open conversation with this contact on this channel
  let conversation = await findOpenConversation(
    msg.accountId,
    msg.contactId,
    msg.channel,
  )

  let isNew = false

  // 2. If no open conversation, create one
  if (!conversation) {
    conversation = await createConversation({
      accountId: msg.accountId,
      contactId: msg.contactId,
      contactName: msg.contactName,
      contactEmail: msg.contactEmail,
      contactPhone: msg.contactPhone,
      channel: msg.channel,
      subject: msg.subject,
      assignedRole: resolveRole(msg.channel),
    })
    isNew = true
  }

  // 3. Add the inbound message to the conversation
  const message = await addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    channel: msg.channel,
    content: msg.content,
    sender: msg.contactName ?? msg.contactEmail ?? msg.contactPhone ?? 'unknown',
    externalId: msg.externalId,
    metadata: msg.metadata,
  })

  return {
    conversation,
    message,
    isNew,
    assignedRole: conversation.assignedRole,
  }
}

/**
 * Route an inbound message to an existing conversation by ID.
 * Used when you already know the conversation (e.g., reply to a known thread).
 */
export async function routeToConversation(
  conversationId: string,
  msg: Pick<InboundMessage, 'channel' | 'content' | 'contactName' | 'contactEmail' | 'contactPhone' | 'externalId' | 'metadata'>,
): Promise<RouteResult> {
  const conversation = await getConversation(conversationId)
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`)
  }

  const message = await addMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    channel: msg.channel,
    content: msg.content,
    sender: msg.contactName ?? msg.contactEmail ?? msg.contactPhone ?? 'unknown',
    externalId: msg.externalId,
    metadata: msg.metadata,
  })

  return {
    conversation,
    message,
    isNew: false,
    assignedRole: conversation.assignedRole,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Determine which role handles a new conversation by default.
 * All channels start with the Front Desk unless overridden.
 */
function resolveRole(_channel: string): string {
  // All inbound starts at the Front Desk — it's the first point of contact.
  // The Front Desk can escalate to the GM if needed.
  return 'front_desk'
}
