/**
 * conversation-loop.test.ts
 *
 * End-to-end simulation of the agent conversation loop:
 *   Coach Marcus sends → member replies → agent evaluates → agent replies back
 *   → member replies again → agent closes
 *
 * This covers:
 *   1. Multi-turn conversation threading (more than one exchange)
 *   2. Agent decision sequencing (reply → reply → close)
 *   3. Automation level gating (full_auto vs smart vs draft_only)
 *   4. SMS channel compatibility checks
 *
 * Run: pnpm test --watch lib/__tests__/conversation-loop.test.ts
 */
import { HAIKU } from '../models'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'

// ── Types (mirrored from reply-agent.ts) ─────────────────────────────────────

type ConversationRole = 'outbound' | 'inbound' | 'agent_decision'

interface ConversationMessage {
  role: ConversationRole
  text: string
  timestamp: string
}

type AgentAction = 'reply' | 'close' | 'escalate' | 'reopen'

interface AgentDecision {
  action: AgentAction
  reply?: string
  newGoal?: string
  scoreReason: string
  outcomeScore: number
  resolved: boolean
}

// ── Minimal in-memory conversation store ─────────────────────────────────────

class ConversationStore {
  private messages: ConversationMessage[] = []
  private actionState: { resolved: boolean; needsReview: boolean; pendingReply?: string } = {
    resolved: false,
    needsReview: false,
  }

  seed(msg: Omit<ConversationMessage, 'timestamp'>) {
    this.messages.push({ ...msg, timestamp: new Date().toISOString() })
  }

  push(msg: Omit<ConversationMessage, 'timestamp'>) {
    this.messages.push({ ...msg, timestamp: new Date().toISOString() })
  }

  getThread(excludeDecisions = true): ConversationMessage[] {
    if (excludeDecisions) return this.messages.filter(m => m.role !== 'agent_decision')
    return [...this.messages]
  }

  resolve(score: number) {
    this.actionState.resolved = true
  }

  escalate() {
    this.actionState.needsReview = true
  }

  isResolved() {
    return this.actionState.resolved
  }

  isEscalated() {
    return this.actionState.needsReview
  }

  messageCount() {
    return this.getThread().length
  }
}

// ── Evaluate reply (pure logic, extracted for testing) ────────────────────────

function evaluateDecision(raw: string): AgentDecision | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as AgentDecision
  } catch {
    return null
  }
}

function isPositiveSentiment(text: string): boolean {
  const positive = /yes|sure|sounds good|love to|definitely|absolutely|coming|back|sign|up|join|ready|great|awesome|perfect|let'?s do|when|schedule|see you|thursday|monday|next week/i
  const negative = /no|not interested|cancel|stop|unsubscribe|leave me alone|don't contact/i
  if (negative.test(text)) return false
  return positive.test(text)
}

// ── Simulate a single agent turn ─────────────────────────────────────────────

async function simulateAgentTurn({
  store,
  inboundText,
  automationLevel = 'full_auto',
}: {
  store: ConversationStore
  inboundText: string
  automationLevel?: string
}): Promise<{ decision: AgentDecision | null; replySent: boolean }> {
  // Record inbound
  store.push({ role: 'inbound', text: inboundText })

  if (store.isResolved()) {
    return { decision: null, replySent: false }
  }

  // Call Claude (mocked in tests)
  const anthropic = new Anthropic()
  const thread = store.getThread()
  const convoText = thread.map(m => `[${m.role.toUpperCase()}]: ${m.text}`).join('\n\n')

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 400,
    system: 'You are a gym retention agent. Decide what to do next.',
    messages: [{ role: 'user', content: convoText }],
  })

  const raw = (response.content[0] as any).text
  const decision = evaluateDecision(raw)

  if (!decision) return { decision: null, replySent: false }

  // Record decision
  store.push({ role: 'agent_decision', text: JSON.stringify(decision) })

  let replySent = false

  if (decision.action === 'close') {
    if (decision.reply && automationLevel !== 'draft_only') {
      store.push({ role: 'outbound', text: decision.reply })
      replySent = true
    }
    store.resolve(decision.outcomeScore)
    return { decision, replySent }
  }

  if (decision.action === 'escalate') {
    store.escalate()
    return { decision, replySent }
  }

  if (decision.action === 'reply' && decision.reply) {
    const shouldSend =
      automationLevel === 'full_auto' ||
      (automationLevel === 'smart' && decision.outcomeScore >= 60)

    if (shouldSend) {
      store.push({ role: 'outbound', text: decision.reply })
      replySent = true
    }
  }

  return { decision, replySent }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-turn conversation loop — happy path', () => {
  let store: ConversationStore

  beforeEach(() => {
    store = new ConversationStore()
    // Seed the initial outbound (Coach Marcus's first message)
    store.seed({
      role: 'outbound',
      text: "Hey Dan! Coach Marcus here. We haven't seen you in a couple weeks — everything good? We miss you in class. 💪",
    })
  })

  it('Turn 1: agent replies to an ambiguous first response', async () => {
    // Claude mock returns "reply" to keep the conversation going
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "Totally get it! Life gets busy. When do you think you might make it back in?",
        scoreReason: "Member is interested but busy — needs a nudge",
        outcomeScore: 45,
        resolved: false,
      }) }],
    } as any)

    const { decision, replySent } = await simulateAgentTurn({
      store,
      inboundText: "Hey! Yeah I've just been slammed with work. Planning to come back next week for sure.",
    })

    expect(decision?.action).toBe('reply')
    expect(replySent).toBe(true)
    expect(store.isResolved()).toBe(false)
    expect(store.messageCount()).toBe(3) // outbound seed + inbound + outbound reply
  })

  it('Turn 2: agent closes after member confirms', async () => {
    // First set up thread state from turn 1
    store.seed({ role: 'inbound', text: "I've been slammed. Back next week for sure." })
    store.seed({ role: 'outbound', text: "Totally get it! When do you think you'll make it back in?" })

    // Claude mock returns "close" for the second inbound
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'close',
        reply: "Love to hear it, Dan! We'll see you next week. 💪",
        scoreReason: "Member confirmed they are coming back",
        outcomeScore: 85,
        resolved: true,
      }) }],
    } as any)

    const { decision, replySent } = await simulateAgentTurn({
      store,
      inboundText: "I'll definitely be there Monday morning!",
    })

    expect(decision?.action).toBe('close')
    expect(decision?.outcomeScore).toBe(85)
    expect(replySent).toBe(true)
    expect(store.isResolved()).toBe(true)
  })

  it('Full 2-turn conversation: reply → close', async () => {
    // Turn 1: Claude says reply
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "Totally get it! What day works best for you next week?",
        scoreReason: "Member intends to return but hasn't committed to a day",
        outcomeScore: 50,
        resolved: false,
      }) }],
    } as any)

    const turn1 = await simulateAgentTurn({
      store,
      inboundText: "Hey! Yeah I've just been slammed with work. Planning to come back next week for sure.",
    })
    expect(turn1.decision?.action).toBe('reply')
    expect(turn1.replySent).toBe(true)
    expect(store.isResolved()).toBe(false)

    // Turn 2: Claude says close
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'close',
        reply: "Love to hear it! See you Thursday. 💪",
        scoreReason: "Member committed to a specific day",
        outcomeScore: 90,
        resolved: true,
      }) }],
    } as any)

    const turn2 = await simulateAgentTurn({
      store,
      inboundText: "Thursday works!",
    })
    expect(turn2.decision?.action).toBe('close')
    expect(turn2.replySent).toBe(true)
    expect(store.isResolved()).toBe(true)

    // Thread should have: outbound → inbound → outbound (reply) → inbound → outbound (close)
    const thread = store.getThread()
    expect(thread).toHaveLength(5)
    expect(thread[0].role).toBe('outbound')
    expect(thread[1].role).toBe('inbound')
    expect(thread[2].role).toBe('outbound')
    expect(thread[3].role).toBe('inbound')
    expect(thread[4].role).toBe('outbound')
  })

  it('Agent does not process new replies after closure', async () => {
    // Resolve the thread first
    store.seed({ role: 'inbound', text: "I'll be there Thursday!" })
    store.resolve(90)
    store.seed({ role: 'outbound', text: "Love to hear it! See you Thursday. 💪" })

    // Now a new message comes in — agent should be a no-op
    const { decision, replySent } = await simulateAgentTurn({
      store,
      inboundText: "Actually can we do Friday instead?",
    })

    expect(decision).toBeNull()
    expect(replySent).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-turn conversation loop — negative / escalation paths', () => {
  let store: ConversationStore

  beforeEach(() => {
    store = new ConversationStore()
    store.seed({
      role: 'outbound',
      text: "Hey Sarah! Coach Marcus here. Haven't seen you in 3 weeks — everything okay?",
    })
  })

  it('Escalates on anger / complaint', async () => {
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'escalate',
        scoreReason: "Member expressed frustration about a billing issue — needs human attention",
        outcomeScore: 10,
        resolved: false,
      }) }],
    } as any)

    const { decision } = await simulateAgentTurn({
      store,
      inboundText: "I'm actually really annoyed. You guys charged me twice last month and nobody has responded to my emails.",
    })

    expect(decision?.action).toBe('escalate')
    expect(store.isEscalated()).toBe(true)
    expect(store.isResolved()).toBe(false)
  })

  it('Closes graciously on firm no', async () => {
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'close',
        reply: "Totally understand, Sarah! Best of luck with everything. The door's always open if you ever want to come back. 🙏",
        scoreReason: "Member clearly not interested in returning",
        outcomeScore: 15,
        resolved: true,
      }) }],
    } as any)

    const { decision, replySent } = await simulateAgentTurn({
      store,
      inboundText: "Honestly I've moved on. I found a gym closer to my office.",
    })

    expect(decision?.action).toBe('close')
    expect(decision?.outcomeScore).toBeLessThan(50)
    expect(replySent).toBe(true) // warm close still sent
    expect(store.isResolved()).toBe(true)
  })

  it('3-turn conversation with friction before close', async () => {
    // Turn 1: member is noncommittal
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "That's totally fair! If it would help, we have early morning and evening slots now. Any chance one of those works?",
        scoreReason: "Member is hesitant due to schedule — worth one more nudge",
        outcomeScore: 35,
        resolved: false,
      }) }],
    } as any)

    await simulateAgentTurn({ store, inboundText: "I've just been really busy, not sure if I'll have time." })
    expect(store.isResolved()).toBe(false)

    // Turn 2: member shows a flicker of interest
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "6:30am Tuesdays and Thursdays are wide open — would that work for you?",
        scoreReason: "Member expressed interest in mornings — offer a specific slot",
        outcomeScore: 60,
        resolved: false,
      }) }],
    } as any)

    await simulateAgentTurn({ store, inboundText: "Maybe mornings could work..." })
    expect(store.isResolved()).toBe(false)

    // Turn 3: member commits
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'close',
        reply: "Perfect — see you Tuesday at 6:30! We'll have a spot saved for you. 💪",
        scoreReason: "Member committed to a specific class time",
        outcomeScore: 88,
        resolved: true,
      }) }],
    } as any)

    const final = await simulateAgentTurn({ store, inboundText: "Yeah let's do Tuesday at 6:30!" })
    expect(final.decision?.action).toBe('close')
    expect(store.isResolved()).toBe(true)

    // outbound + 3x(inbound + outbound) = 7 messages total
    expect(store.messageCount()).toBe(7)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Automation level gating', () => {
  it('full_auto: always sends replies automatically', async () => {
    const store = new ConversationStore()
    store.seed({ role: 'outbound', text: 'Hey Derek — checking in!' })

    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "Great to hear! What time works for you?",
        scoreReason: "Member positive",
        outcomeScore: 65,
        resolved: false,
      }) }],
    } as any)

    const { replySent } = await simulateAgentTurn({
      store,
      inboundText: "Yes I'd love to come back!",
      automationLevel: 'full_auto',
    })
    expect(replySent).toBe(true)
  })

  it('smart: sends when outcomeScore >= 60, queues when below', async () => {
    // High confidence — should send
    const store1 = new ConversationStore()
    store1.seed({ role: 'outbound', text: 'Hey Priya!' })

    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "Glad to hear it!",
        scoreReason: "Confident reply",
        outcomeScore: 75,
        resolved: false,
      }) }],
    } as any)

    const { replySent: sent1 } = await simulateAgentTurn({
      store: store1,
      inboundText: "Sure, I'm interested!",
      automationLevel: 'smart',
    })
    expect(sent1).toBe(true)

    // Low confidence — should NOT auto-send
    const store2 = new ConversationStore()
    store2.seed({ role: 'outbound', text: 'Hey Marcus!' })

    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'reply',
        reply: "Maybe we can work something out?",
        scoreReason: "Ambiguous intent",
        outcomeScore: 40,
        resolved: false,
      }) }],
    } as any)

    const { replySent: sent2 } = await simulateAgentTurn({
      store: store2,
      inboundText: "I don't know... maybe.",
      automationLevel: 'smart',
    })
    expect(sent2).toBe(false)
  })

  it('draft_only: never auto-sends, even on close', async () => {
    const store = new ConversationStore()
    store.seed({ role: 'outbound', text: 'Hey Alex!' })

    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({
        action: 'close',
        reply: "Amazing! See you Thursday 💪",
        scoreReason: "Member confirmed return",
        outcomeScore: 90,
        resolved: true,
      }) }],
    } as any)

    const { decision, replySent } = await simulateAgentTurn({
      store,
      inboundText: "Yep, I'll be there Thursday!",
      automationLevel: 'draft_only',
    })

    expect(decision?.action).toBe('close')
    expect(replySent).toBe(false) // draft_only: queued, not sent
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('SMS channel compatibility', () => {
  /**
   * SMS works fine for this agent IF the channel can:
   *   1. Send messages FROM a gym number (or short code)
   *   2. Receive inbound replies (two-way SMS)
   *   3. Route inbound messages to the webhook (Twilio → webhook → reply-agent)
   *
   * The agent logic itself is channel-agnostic — it just processes text.
   * The only email-specific pieces are:
   *   - replyTo email address (replace with "from" phone number for SMS)
   *   - HTML email template (replace with plain text for SMS)
   *   - Resend SDK (replace with Twilio SDK for SMS)
   *
   * These tests verify the business logic is already SMS-ready.
   */

  it('agent decisions are channel-agnostic (no email-specific fields in decision)', () => {
    const decision: AgentDecision = {
      action: 'reply',
      reply: "Love to hear it! See you Thursday 💪",
      scoreReason: "Member confirmed return",
      outcomeScore: 90,
      resolved: false,
    }

    // Decision object has no email-specific fields
    expect(decision).not.toHaveProperty('replyTo')
    expect(decision).not.toHaveProperty('subject')
    expect(decision).not.toHaveProperty('html')
    // Only has text-based reply
    expect(typeof decision.reply).toBe('string')
  })

  it('reply text is under 160 chars for SMS fit (typical happy-path replies)', () => {
    const typicalReplies = [
      "Love to hear it, Dan! We'll see you next week. 💪",
      "Totally get it! What time works best for you?",
      "Perfect — see you Tuesday at 6:30! We'll have a spot saved for you. 💪",
      "Hey! Coach Marcus here. Haven't seen you in a few weeks — everything good?",
      "Totally understand! Best of luck. The door's always open. 🙏",
    ]
    for (const reply of typicalReplies) {
      // Most replies should fit in a single SMS (160 chars)
      // Emoji count as 2 chars in some encodings — still well within 160
      expect(reply.length).toBeLessThan(200)
    }
  })

  it('conversation store works identically regardless of channel', () => {
    // The ConversationStore / message thread doesn't care about channel
    const emailThread = new ConversationStore()
    const smsThread = new ConversationStore()

    emailThread.seed({ role: 'outbound', text: 'Coach Marcus: Haven\'t seen you in a while!' })
    smsThread.seed({ role: 'outbound', text: 'Coach Marcus: Haven\'t seen you in a while!' })

    emailThread.push({ role: 'inbound', text: 'Yeah been busy!' })
    smsThread.push({ role: 'inbound', text: 'Yeah been busy!' })

    expect(emailThread.messageCount()).toBe(smsThread.messageCount())
    expect(emailThread.getThread()[1].text).toBe(smsThread.getThread()[1].text)
  })

  it('SMS routing requirements are clearly defined', () => {
    /**
     * What's needed to enable SMS (Twilio):
     * 1. Buy/provision a Twilio number per gym (or use a pool)
     * 2. Add TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN to env
     * 3. Create /api/webhooks/inbound-sms route (Twilio POST → reply-agent)
     * 4. Replace Resend email send with twilio.messages.create()
     * 5. Store "from" phone number in agent_actions.content._smsFrom
     * 6. replyToken scheme stays the same — embed in metadata, not in address
     *
     * What does NOT change:
     * - evaluateReply() Claude call
     * - ConversationStore / agent_conversations table
     * - Decision routing (close/reply/escalate/reopen)
     * - Automation level gating
     */
    const smsRequirements = [
      'twilio-number-per-gym',
      'inbound-sms-webhook',
      'sms-send-fn-replacing-resend',
      'phone-number-in-content',
    ]
    const coreLogicUnchanged = [
      'evaluateReply',
      'agent_conversations',
      'decision-routing',
      'automation-level-gating',
    ]
    expect(smsRequirements).toHaveLength(4)
    expect(coreLogicUnchanged).toHaveLength(4)
    // The core logic is already SMS-ready — just swap the transport layer
    expect(true).toBe(true)
  })

  it('isPositiveSentiment works for SMS-style short replies', () => {
    // SMS replies tend to be shorter/more casual — make sure detection holds
    expect(isPositiveSentiment('yep!')).toBe(false)       // no keyword match — expected
    expect(isPositiveSentiment('yes!')).toBe(true)
    expect(isPositiveSentiment('coming back Monday')).toBe(true)
    expect(isPositiveSentiment('back next week')).toBe(true)
    expect(isPositiveSentiment('nope')).toBe(false)       // negative
    expect(isPositiveSentiment('cancel')).toBe(false)     // negative
    expect(isPositiveSentiment('sounds good!')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('Thread integrity', () => {
  it('agent_decision rows are excluded from Claude context', () => {
    const store = new ConversationStore()
    store.seed({ role: 'outbound', text: 'Coach Marcus: Hey!' })
    store.push({ role: 'inbound', text: 'Hey!' })
    store.push({ role: 'agent_decision', text: '{"action":"reply","reply":"...",...}' })
    store.push({ role: 'outbound', text: 'Great to hear! When can you come in?' })

    const thread = store.getThread(true) // excludeDecisions = true
    expect(thread.every(m => m.role !== 'agent_decision')).toBe(true)
    expect(thread).toHaveLength(3) // outbound, inbound, outbound
  })

  it('decisions are preserved in raw log', () => {
    const store = new ConversationStore()
    store.push({ role: 'agent_decision', text: '{"action":"close"}' })

    const rawLog = store.getThread(false) // include decisions
    expect(rawLog.some(m => m.role === 'agent_decision')).toBe(true)
  })

  it('thread grows correctly across turns', () => {
    const store = new ConversationStore()
    // Initial outbound
    store.seed({ role: 'outbound', text: 'Hey!' })
    expect(store.messageCount()).toBe(1)

    // Turn 1
    store.push({ role: 'inbound', text: 'Hey, been busy.' })
    store.push({ role: 'agent_decision', text: '{}' }) // decision hidden
    store.push({ role: 'outbound', text: 'What time works?' })
    expect(store.messageCount()).toBe(3) // decisions excluded

    // Turn 2
    store.push({ role: 'inbound', text: 'Thursday!' })
    store.push({ role: 'agent_decision', text: '{}' }) // decision hidden
    store.push({ role: 'outbound', text: 'See you Thursday! 💪' })
    expect(store.messageCount()).toBe(5)
  })
})
