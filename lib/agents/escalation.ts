/**
 * Conversation handoff — generic role-to-role routing.
 *
 * Handles any role transition: Front Desk → GM, GM → Sales Agent, etc.
 * The caller specifies the target role; this module handles:
 *   1. Reassigning the conversation to the target role
 *   2. Starting a session for the target role with full context
 *   3. Returning session events for the caller to consume
 *
 * `escalateToGM()` is a convenience wrapper that calls `handoffConversation()`
 * with targetRole='gm' for backward compatibility.
 */

import { startSession } from './session-runtime'
import {
  getConversation,
  getConversationMessages,
  reassignConversation,
  linkSession,
} from '../db/conversations'
import type { SessionEvent, AutonomyMode } from './tools/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HandoffConfig {
  /** PushPress credentials */
  apiKey: string
  companyId: string
  /** Max turns for the target session (default 15) */
  maxTurns?: number
  /** Budget in cents (default 75) */
  budgetCents?: number
  /** Tool groups for the target role (default: data, conversation, action, learning) */
  tools?: string[]
  /** Autonomy mode for the target role (default: semi_auto) */
  autonomyMode?: AutonomyMode
}

/** @deprecated Use HandoffConfig */
export type EscalationConfig = HandoffConfig

// ── Generic handoff ──────────────────────────────────────────────────────────

/**
 * Hand off a conversation to a different role.
 *
 * 1. Loads the conversation and validates it exists
 * 2. Reassigns the conversation to the target role
 * 3. Starts a session for the target role with conversation history + context
 * 4. Returns an async generator of SessionEvents
 */
export async function* handoffConversation(
  conversationId: string,
  targetRole: string,
  reason: string,
  context: string | undefined,
  config: HandoffConfig,
): AsyncGenerator<SessionEvent> {
  // 1. Load conversation
  const conversation = await getConversation(conversationId)
  if (!conversation) {
    yield { type: 'error', message: `Conversation ${conversationId} not found` }
    return
  }

  const previousRole = conversation.assignedRole

  // 2. Reassign to target role
  await reassignConversation(conversationId, targetRole, 'escalated')

  // 3. Load conversation history for context
  const history = await getConversationMessages(conversationId, { limit: 50 })

  // 4. Build the goal for the target session
  const goal = buildHandoffGoal(conversation, targetRole, previousRole, reason, context, history)

  // 5. Start a session for the target role
  const sessionGen = startSession({
    accountId: conversation.accountId,
    goal,
    role: targetRole,
    tools: config.tools ?? ['data', 'conversation', 'action', 'learning'],
    autonomyMode: config.autonomyMode ?? 'semi_auto',
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

// ── Convenience wrapper: escalate to GM ──────────────────────────────────────

/**
 * Escalate a conversation to the GM. Convenience wrapper around handoffConversation.
 */
export async function* escalateToGM(
  conversationId: string,
  reason: string,
  context: string | undefined,
  config: HandoffConfig,
): AsyncGenerator<SessionEvent> {
  yield* handoffConversation(conversationId, 'gm', reason, context, config)
}

// ── Goal builder ──────────────────────────────────────────────────────────────

function buildHandoffGoal(
  conversation: {
    id: string
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
    contactId: string
    channel: string
    assignedRole: string
  },
  targetRole: string,
  previousRole: string,
  reason: string,
  context: string | undefined,
  history: Array<{ direction: string; channel: string; sender: string | null; content: string; createdAt: string }>,
): string {
  const parts: string[] = []

  // Handoff header
  const fromLabel = formatRoleLabel(previousRole)
  parts.push(`## Handoff from ${fromLabel}`)
  parts.push(`${fromLabel} has handed this conversation to you. This needs your attention.`)
  parts.push('')

  // Reason
  parts.push(`**Handoff Reason:** ${reason}`)
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
      const label = msg.direction === 'inbound' ? (msg.sender ?? 'Contact') : formatRoleLabel(previousRole)
      parts.push(`${arrow} **${label}** (${msg.channel}): ${msg.content.slice(0, 500)}`)
    }
    parts.push('')
  }

  // Instructions
  parts.push(`## Your Task`)
  parts.push(`1. Use \`get_conversation_history\` to review the full thread if needed.`)
  parts.push(`2. Use \`get_member_detail\` to pull this contact's profile, attendance, payments, and account status.`)
  parts.push(`3. Evaluate the situation with the context of the handoff reason.`)
  parts.push(`4. Decide on the appropriate action — respond directly, offer a resolution, or hand off further.`)
  parts.push(`5. Use \`send_reply\` with conversation_id="${conversation.id}" to communicate with the contact.`)
  parts.push(`6. Use \`handoff_conversation\` to route to another role if needed, or \`request_input\` to brief the owner.`)

  return parts.join('\n')
}

/** Format a role slug into a readable label (e.g., 'front_desk' → 'Front Desk') */
function formatRoleLabel(role: string): string {
  return role
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
