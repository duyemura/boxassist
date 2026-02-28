/**
 * DB helpers for the unified conversations table.
 *
 * All communication channels (email, SMS, WhatsApp, Instagram, voice, chat)
 * are stored as conversations. The Front Desk Agent thinks in conversations,
 * not channels — channel is just delivery metadata.
 */

import { supabaseAdmin } from '../supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConversationStatus = 'open' | 'resolved' | 'escalated' | 'waiting_member' | 'waiting_agent'
export type MessageDirection = 'inbound' | 'outbound'

export interface Conversation {
  id: string
  accountId: string
  contactId: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  channel: string
  status: ConversationStatus
  assignedRole: string
  sessionId: string | null
  subject: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  direction: MessageDirection
  channel: string
  content: string
  sender: string | null
  externalId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Get open/active conversations for an account, optionally filtered by role.
 */
export async function getConversations(
  accountId: string,
  opts: { status?: ConversationStatus | ConversationStatus[]; assignedRole?: string; limit?: number } = {},
): Promise<Conversation[]> {
  let query = supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 50)

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status]
    query = query.in('status', statuses)
  }
  if (opts.assignedRole) {
    query = query.eq('assigned_role', opts.assignedRole)
  }

  const { data, error } = await query
  if (error) throw new Error(`getConversations failed: ${error.message}`)
  return (data ?? []).map(rowToConversation)
}

/**
 * Get a single conversation by ID.
 */
export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getConversation failed: ${error.message}`)
  }
  return data ? rowToConversation(data) : null
}

/**
 * Find an existing open conversation with a contact (for continuing threads).
 */
export async function findOpenConversation(
  accountId: string,
  contactId: string,
  channel?: string,
): Promise<Conversation | null> {
  let query = supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .in('status', ['open', 'waiting_member', 'waiting_agent'])
    .order('updated_at', { ascending: false })
    .limit(1)

  if (channel) {
    query = query.eq('channel', channel)
  }

  const { data, error } = await query
  if (error) throw new Error(`findOpenConversation failed: ${error.message}`)
  return data?.length ? rowToConversation(data[0]) : null
}

/**
 * Get messages for a conversation, chronological.
 */
export async function getConversationMessages(
  conversationId: string,
  opts: { limit?: number } = {},
): Promise<ConversationMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 200)

  if (error) throw new Error(`getConversationMessages failed: ${error.message}`)
  return (data ?? []).map(rowToMessage)
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Create a new conversation.
 */
export async function createConversation(params: {
  accountId: string
  contactId: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  channel: string
  assignedRole?: string
  subject?: string
  metadata?: Record<string, unknown>
}): Promise<Conversation> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      account_id: params.accountId,
      contact_id: params.contactId,
      contact_name: params.contactName ?? null,
      contact_email: params.contactEmail ?? null,
      contact_phone: params.contactPhone ?? null,
      channel: params.channel,
      assigned_role: params.assignedRole ?? 'front_desk',
      subject: params.subject ?? null,
      metadata: params.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw new Error(`createConversation failed: ${error.message}`)
  return rowToConversation(data)
}

/**
 * Add a message to a conversation. Also touches updated_at on the conversation.
 */
export async function addMessage(params: {
  conversationId: string
  direction: MessageDirection
  channel: string
  content: string
  sender?: string
  externalId?: string
  metadata?: Record<string, unknown>
}): Promise<ConversationMessage> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      conversation_id: params.conversationId,
      direction: params.direction,
      channel: params.channel,
      content: params.content,
      sender: params.sender ?? null,
      external_id: params.externalId ?? null,
      metadata: params.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw new Error(`addMessage failed: ${error.message}`)

  // Touch conversation updated_at
  await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', params.conversationId)

  return rowToMessage(data)
}

/**
 * Update conversation status.
 */
export async function updateConversationStatus(
  id: string,
  status: ConversationStatus,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (metadata) update.metadata = metadata

  const { error } = await supabaseAdmin
    .from('conversations')
    .update(update)
    .eq('id', id)

  if (error) throw new Error(`updateConversationStatus failed: ${error.message}`)
}

/**
 * Assign a conversation to a different role (e.g., front_desk → gm for escalation).
 */
export async function reassignConversation(
  id: string,
  assignedRole: string,
  status?: ConversationStatus,
): Promise<void> {
  const update: Record<string, unknown> = {
    assigned_role: assignedRole,
    updated_at: new Date().toISOString(),
  }
  if (status) update.status = status

  const { error } = await supabaseAdmin
    .from('conversations')
    .update(update)
    .eq('id', id)

  if (error) throw new Error(`reassignConversation failed: ${error.message}`)
}

/**
 * Link a conversation to an agent session.
 */
export async function linkSession(
  conversationId: string,
  sessionId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversations')
    .update({ session_id: sessionId, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) throw new Error(`linkSession failed: ${error.message}`)
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    accountId: row.account_id,
    contactId: row.contact_id,
    contactName: row.contact_name ?? null,
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    channel: row.channel,
    status: row.status,
    assignedRole: row.assigned_role,
    sessionId: row.session_id ?? null,
    subject: row.subject ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    channel: row.channel,
    content: row.content,
    sender: row.sender ?? null,
    externalId: row.external_id ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }
}
