/**
 * Escalation — handles handoff from Front Desk → GM.
 *
 * When the Front Desk agent encounters a situation beyond its authority
 * (cancellation, refund, complaint, etc.), it escalates to the GM.
 *
 * This module:
 *   1. Reassigns the conversation to the GM role
 *   2. Starts a GM session with full conversation context + escalation reason
 *   3. Returns session events for the caller to consume
 */

import { startSession } from './session-runtime'
import {
  getConversation,
  getConversationMessages,
  reassignConversation,
  linkSession,
} from '../db/conversations'
import type { SessionEvent } from './tools/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EscalationConfig {
  /** PushPress credentials */
  apiKey: string
  companyId: string
  /** Max turns for the GM session (default 15) */
  maxTurns?: number
  /** Budget in cents (default 75) */
  budgetCents?: number
}

export interface EscalationResult {
  conversationId: string
  previousRole: string
  newRole: string
  reason: string
}

// ── Escalate to GM ────────────────────────────────────────────────────────────

/**
 * Escalate a conversation from the Front Desk to the GM.
 *
 * 1. Loads the conversation and validates it exists
 * 2. Reassigns the conversation to the GM role with status 'escalated'
 * 3. Starts a GM session with conversation history + escalation context
 * 4. Returns an async generator of SessionEvents
 */
export async function* escalateToGM(
  conversationId: string,
  reason: string,
  context: string | undefined,
  config: EscalationConfig,
): AsyncGenerator<SessionEvent> {
  // 1. Load conversation
  const conversation = await getConversation(conversationId)
  if (!conversation) {
    yield { type: 'error', message: `Conversation ${conversationId} not found` }
    return
  }

  const previousRole = conversation.assignedRole

  // 2. Reassign to GM
  await reassignConversation(conversationId, 'gm', 'escalated')

  // 3. Load conversation history for GM context
  const history = await getConversationMessages(conversationId, { limit: 50 })

  // 4. Build the goal for the GM session
  const goal = buildEscalationGoal(conversation, reason, context, history)

  // 5. Start a GM session
  const sessionGen = startSession({
    accountId: conversation.accountId,
    goal,
    role: 'gm',
    tools: ['data', 'conversation', 'action', 'learning'],
    autonomyMode: 'semi_auto',
    maxTurns: config.maxTurns ?? 15,
    budgetCents: config.budgetCents ?? 75,
    apiKey: config.apiKey,
    companyId: config.companyId,
    createdBy: 'event',
  })

  // 6. Yield events and link session to conversation
  let sessionId: string | null = null

  for await (const event of sessionGen) {
    if (event.type === 'session_created') {
      sessionId = event.sessionId
      await linkSession(conversationId, sessionId)
    }
    yield event
  }
}

// ── Goal builder ──────────────────────────────────────────────────────────────

function buildEscalationGoal(
  conversation: {
    id: string
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
    contactId: string
    channel: string
    assignedRole: string
  },
  reason: string,
  context: string | undefined,
  history: Array<{ direction: string; channel: string; sender: string | null; content: string; createdAt: string }>,
): string {
  const parts: string[] = []

  // Escalation header
  parts.push(`## Escalation from Front Desk`)
  parts.push(`The Front Desk has escalated this conversation to you. This needs your judgment.`)
  parts.push('')

  // Reason
  parts.push(`**Escalation Reason:** ${reason}`)
  if (context) {
    parts.push(`**Additional Context:** ${context}`)
  }
  parts.push('')

  // Contact info
  parts.push(`**Contact:** ${conversation.contactName ?? 'Unknown'}`)
  if (conversation.contactEmail) parts.push(`**Email:** ${conversation.contactEmail}`)
  if (conversation.contactPhone) parts.push(`**Phone:** ${conversation.contactPhone}`)
  parts.push(`**Channel:** ${conversation.channel}`)
  parts.push(`**Contact ID:** ${conversation.contactId}`)
  parts.push(`**Conversation ID:** ${conversation.id}`)
  parts.push('')

  // Conversation history
  if (history.length > 0) {
    parts.push(`## Full Conversation History (${history.length} messages)`)
    for (const msg of history) {
      const arrow = msg.direction === 'inbound' ? '\u2190' : '\u2192'
      const label = msg.direction === 'inbound' ? (msg.sender ?? 'Contact') : 'Front Desk'
      parts.push(`${arrow} **${label}** (${msg.channel}): ${msg.content.slice(0, 500)}`)
    }
    parts.push('')
  }

  // Instructions
  parts.push(`## Your Task`)
  parts.push(`1. Use \`get_conversation_history\` to review the full thread if needed.`)
  parts.push(`2. Use \`get_member_detail\` to pull this contact's profile, attendance, payments, and account status.`)
  parts.push(`3. Evaluate the situation with the context of the escalation reason.`)
  parts.push(`4. Decide on the appropriate action — respond directly, offer a resolution, or escalate to the owner.`)
  parts.push(`5. Use \`send_reply\` with conversation_id="${conversation.id}" to communicate with the contact.`)
  parts.push(`6. If this needs the owner's attention, use \`request_input\` to brief them.`)

  return parts.join('\n')
}
