/**
 * Front Desk Agent — the first point of contact for all inbound communication.
 *
 * Handles inbound messages by:
 *   1. Loading conversation history for context
 *   2. Starting a session with the front-desk role
 *   3. Letting the agent decide how to respond (or escalate)
 *
 * The agent has access to:
 *   - Conversation history (injected in goal)
 *   - Member data tools (PushPress)
 *   - send_reply tool (sends through appropriate channel)
 *   - Business memories
 *   - Escalation tools
 */

import { startSession } from './session-runtime'
import { getConversationMessages, linkSession } from '../db/conversations'
import type { RouteResult } from '../channel-router'
import type { SessionEvent } from './tools/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FrontDeskConfig {
  /** PushPress credentials */
  apiKey: string
  companyId: string
  /** Max turns for the session (default 10) */
  maxTurns?: number
  /** Budget in cents (default 50) */
  budgetCents?: number
}

// ── Handle inbound ────────────────────────────────────────────────────────────

/**
 * Handle an inbound message routed to the Front Desk.
 *
 * Creates a session with the front-desk role, injects conversation context,
 * and lets the agent decide how to respond.
 *
 * Returns an async generator of SessionEvents — the caller can stream these
 * as SSE events, log them, or consume them silently.
 */
export async function* handleInbound(
  route: RouteResult,
  config: FrontDeskConfig,
): AsyncGenerator<SessionEvent> {
  const { conversation, message } = route

  // Load recent conversation history for context
  const history = await getConversationMessages(conversation.id, { limit: 20 })

  // Build the goal with conversation context
  const goal = buildGoal(conversation, message, history)

  // Start a session with the front-desk role
  const sessionGen = startSession({
    accountId: conversation.accountId,
    goal,
    role: 'front-desk',
    tools: ['data', 'conversation', 'learning'],
    autonomyMode: 'full_auto',
    maxTurns: config.maxTurns ?? 10,
    budgetCents: config.budgetCents ?? 50,
    apiKey: config.apiKey,
    companyId: config.companyId,
    createdBy: 'event',
  })

  // Yield events and capture the session ID to link to the conversation
  let sessionId: string | null = null

  for await (const event of sessionGen) {
    if (event.type === 'session_created') {
      sessionId = event.sessionId
      // Link the session to the conversation
      await linkSession(conversation.id, sessionId)
    }
    yield event
  }
}

// ── Goal builder ──────────────────────────────────────────────────────────────

function buildGoal(
  conversation: RouteResult['conversation'],
  inboundMessage: RouteResult['message'],
  history: Array<{ direction: string; channel: string; sender: string | null; content: string; createdAt: string }>,
): string {
  const parts: string[] = []

  // Context header
  parts.push(`## Inbound Message`)
  parts.push(`A ${inboundMessage.channel} message just arrived that needs your attention.`)
  parts.push('')

  // Contact info
  parts.push(`**Contact:** ${conversation.contactName ?? 'Unknown'}`)
  if (conversation.contactEmail) parts.push(`**Email:** ${conversation.contactEmail}`)
  if (conversation.contactPhone) parts.push(`**Phone:** ${conversation.contactPhone}`)
  parts.push(`**Channel:** ${inboundMessage.channel}`)
  parts.push(`**Contact ID:** ${conversation.contactId}`)
  parts.push(`**Conversation ID:** ${conversation.id}`)
  parts.push('')

  // The new message
  parts.push(`## New Message`)
  parts.push(`> ${inboundMessage.content}`)
  parts.push('')

  // Prior history (if any)
  if (history.length > 1) { // >1 because the inbound message itself is in history
    parts.push(`## Conversation History (${history.length - 1} prior messages)`)
    // Show all messages except the latest one (which is the inbound we just received)
    for (const msg of history.slice(0, -1)) {
      const arrow = msg.direction === 'inbound' ? '←' : '→'
      const label = msg.direction === 'inbound' ? (msg.sender ?? 'Contact') : 'You'
      parts.push(`${arrow} **${label}** (${msg.channel}): ${msg.content.slice(0, 500)}`)
    }
    parts.push('')
  }

  // Instructions
  parts.push(`## Your Task`)
  parts.push(`1. Use \`get_member_detail\` to look up this contact's profile, attendance, and account status.`)
  parts.push(`2. Consider the conversation history and the new message.`)
  parts.push(`3. Decide on the best response — be helpful, warm, and concise.`)
  parts.push(`4. Use \`send_reply\` with conversation_id="${conversation.id}" to send your response.`)
  parts.push(`5. If this needs the GM's attention (billing dispute, cancellation request, complaint), use \`escalate\` instead.`)

  return parts.join('\n')
}
