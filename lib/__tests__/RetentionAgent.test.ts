/**
 * RetentionAgent.test.ts
 *
 * TDD tests for RetentionAgent — all Claude calls are mocked via deps.claude.evaluate.
 * NEVER hits the real Anthropic API.
 *
 * Scenarios:
 *   - handleReply: appends member msg, calls evaluateTask, issues correct action
 *   - evaluateTask: passes correct context to Claude, parses response
 *   - evaluateTask: handles malformed JSON gracefully
 *   - Vague reply  → action='reply' (not close)
 *   - Explicit no  → action='close', outcome='churned'
 *   - Commitment   → action='close', outcome='engaged'
 *   - Complaint    → action='escalate'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetentionAgent } from '../agents/RetentionAgent'
import type { AgentDeps } from '../agents/BaseAgent'
import type {
  AgentTask,
  TaskConversationMessage,
  OutboundMessage,
  TaskEvaluation,
} from '../types/agents'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeTask = (overrides: Partial<AgentTask> = {}): AgentTask => ({
  id: 'task-123',
  gym_id: 'gym-001',
  assigned_agent: 'retention',
  created_by_agent: 'retention',
  task_type: 'attendance_drop_intervention',
  member_id: 'member-001',
  lead_id: null,
  member_email: 'dan@example.com',
  member_name: 'Dan',
  goal: 'Re-engage member who has dropped attendance',
  context: { gymName: 'Iron & Grit CrossFit' },
  status: 'awaiting_reply',
  next_action_at: null,
  requires_approval: false,
  approved_at: null,
  approved_by: null,
  outcome: null,
  outcome_score: null,
  outcome_reason: null,
  resolved_at: null,
  causation_event_id: null,
  legacy_action_id: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeConversationMsg = (
  role: 'agent' | 'member' | 'system',
  content: string,
): TaskConversationMessage => ({
  id: `msg-${Math.random().toString(36).slice(2)}`,
  task_id: 'task-123',
  gym_id: 'gym-001',
  role,
  content,
  agent_name: role === 'agent' ? 'retention' : null,
  evaluation: null,
  created_at: '2024-01-01T00:00:00Z',
})

const makeOutboundMessage = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id: 'msg-out-001',
  gym_id: 'gym-001',
  task_id: 'task-123',
  sent_by_agent: 'retention',
  channel: 'email',
  recipient_email: 'dan@example.com',
  recipient_phone: null,
  recipient_name: 'Dan',
  subject: 'Checking in',
  body: 'Hey Dan!',
  reply_token: null,
  status: 'queued',
  provider: 'resend',
  provider_message_id: null,
  delivered_at: null,
  failed_reason: null,
  replied_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// ── Mock deps factory ─────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  const db: AgentDeps['db'] = {
    getTask: vi.fn().mockResolvedValue(makeTask()),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    appendConversation: vi.fn().mockResolvedValue(undefined),
    getConversationHistory: vi.fn().mockResolvedValue([
      makeConversationMsg('agent', "Hey Dan! Haven't seen you in a while — everything okay?"),
    ]),
    createOutboundMessage: vi.fn().mockResolvedValue(makeOutboundMessage()),
    updateOutboundMessageStatus: vi.fn().mockResolvedValue(undefined),
  }

  const events: AgentDeps['events'] = {
    publishEvent: vi.fn().mockResolvedValue('event-id-001'),
  }

  const mailer: AgentDeps['mailer'] = {
    sendEmail: vi.fn().mockResolvedValue({ id: 'email-sent-001' }),
  }

  const claude: AgentDeps['claude'] = {
    evaluate: vi.fn().mockResolvedValue(
      JSON.stringify({
        reasoning: 'Member gave a vague reply',
        action: 'reply',
        reply: 'What day works best for you?',
        outcomeScore: 40,
        resolved: false,
        scoreReason: 'No concrete commitment yet',
      } satisfies TaskEvaluation),
    ),
  }

  return {
    db: { ...db, ...(overrides.db ?? {}) },
    events: { ...events, ...(overrides.events ?? {}) },
    mailer: { ...mailer, ...(overrides.mailer ?? {}) },
    claude: { ...claude, ...(overrides.claude ?? {}) },
    ...(overrides.sms ? { sms: overrides.sms } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// handleReply tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RetentionAgent.handleReply', () => {
  it('appends member reply to conversation before evaluating', async () => {
    const deps = makeDeps()
    const agent = new RetentionAgent(deps)

    await agent.handleReply({
      taskId: 'task-123',
      memberEmail: 'dan@example.com',
      replyContent: "I'll check the schedule.",
      gymId: 'gym-001',
    })

    // appendConversation should have been called with the member message
    expect(deps.db.appendConversation).toHaveBeenCalledWith('task-123', expect.objectContaining({
      role: 'member',
      content: "I'll check the schedule.",
      gymId: 'gym-001',
    }))
  })

  it('calls evaluateTask after appending conversation', async () => {
    const deps = makeDeps()
    const agent = new RetentionAgent(deps)
    const evaluateSpy = vi.spyOn(agent, 'evaluateTask')

    await agent.handleReply({
      taskId: 'task-123',
      memberEmail: 'dan@example.com',
      replyContent: 'Some message',
      gymId: 'gym-001',
    })

    expect(evaluateSpy).toHaveBeenCalledWith('task-123')
  })

  it('action=reply: sends email and appends agent reply to conversation', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Vague reply — ask for specific day',
          action: 'reply',
          reply: 'What day works best for you?',
          outcomeScore: 45,
          resolved: false,
          scoreReason: 'No concrete commitment',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    await agent.handleReply({
      taskId: 'task-123',
      memberEmail: 'dan@example.com',
      replyContent: "I'll check the schedule.",
      gymId: 'gym-001',
    })

    // Should send an email
    expect(deps.mailer.sendEmail).toHaveBeenCalled()

    // Should append the agent's reply to the conversation
    expect(deps.db.appendConversation).toHaveBeenCalledWith('task-123', expect.objectContaining({
      role: 'agent',
      agentName: 'retention',
    }))
  })

  it('action=close (churned): closes task with churned outcome', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Member explicitly said not interested',
          action: 'close',
          reply: "Totally understand! Best of luck.",
          outcomeScore: 10,
          resolved: true,
          scoreReason: 'Member declined',
          outcome: 'churned',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    await agent.handleReply({
      taskId: 'task-123',
      memberEmail: 'dan@example.com',
      replyContent: 'not interested',
      gymId: 'gym-001',
    })

    expect(deps.db.updateTaskStatus).toHaveBeenCalledWith('task-123', 'resolved', expect.objectContaining({
      outcome: 'churned',
    }))
  })

  it('action=close (engaged): closes task with engaged outcome', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Member committed to Thursday',
          action: 'close',
          reply: "Love it — see you Thursday! 💪",
          outcomeScore: 90,
          resolved: true,
          scoreReason: 'Concrete commitment made',
          outcome: 'engaged',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    await agent.handleReply({
      taskId: 'task-123',
      memberEmail: 'dan@example.com',
      replyContent: "I'll be there Thursday",
      gymId: 'gym-001',
    })

    expect(deps.db.updateTaskStatus).toHaveBeenCalledWith('task-123', 'resolved', expect.objectContaining({
      outcome: 'engaged',
    }))
  })

  it('action=escalate: escalates task status', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Member has a complaint requiring human attention',
          action: 'escalate',
          outcomeScore: 5,
          resolved: false,
          scoreReason: 'Billing complaint — needs human',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    await agent.handleReply({
      taskId: 'task-123',
      memberEmail: 'dan@example.com',
      replyContent: "I've been waiting for a callback for weeks",
      gymId: 'gym-001',
    })

    expect(deps.db.updateTaskStatus).toHaveBeenCalledWith('task-123', 'escalated', expect.objectContaining({
      outcome: 'escalated',
    }))
  })

  it('does nothing if task is not found', async () => {
    const deps = makeDeps({
      db: {
        getTask: vi.fn().mockResolvedValue(null),
        updateTaskStatus: vi.fn(),
        appendConversation: vi.fn(),
        getConversationHistory: vi.fn().mockResolvedValue([]),
        createOutboundMessage: vi.fn(),
        updateOutboundMessageStatus: vi.fn(),
      },
    })

    const agent = new RetentionAgent(deps)
    // Should not throw
    await expect(agent.handleReply({
      taskId: 'nonexistent-task',
      memberEmail: 'dan@example.com',
      replyContent: 'Hello',
      gymId: 'gym-001',
    })).resolves.toBeUndefined()

    expect(deps.db.updateTaskStatus).not.toHaveBeenCalled()
    expect(deps.mailer.sendEmail).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// evaluateTask tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RetentionAgent.evaluateTask', () => {
  it('passes task context and conversation history to Claude', async () => {
    const deps = makeDeps({
      db: {
        getTask: vi.fn().mockResolvedValue(makeTask({ goal: 'Get Dan back to class' })),
        updateTaskStatus: vi.fn(),
        appendConversation: vi.fn(),
        getConversationHistory: vi.fn().mockResolvedValue([
          makeConversationMsg('agent', 'Hey Dan! How are you?'),
          makeConversationMsg('member', "I've been busy."),
        ]),
        createOutboundMessage: vi.fn(),
        updateOutboundMessageStatus: vi.fn(),
      },
    })

    const agent = new RetentionAgent(deps)
    await agent.evaluateTask('task-123')

    // Claude's evaluate should have been called
    expect(deps.claude.evaluate).toHaveBeenCalledTimes(1)

    // The prompt should include the goal and conversation content
    const [system, prompt] = (deps.claude.evaluate as any).mock.calls[0]
    expect(system).toContain('retention')
    expect(prompt).toContain('Get Dan back to class')
    expect(prompt).toContain("I've been busy.")
  })

  it('returns parsed TaskEvaluation on valid Claude response', async () => {
    const expected: TaskEvaluation = {
      reasoning: 'Member vague',
      action: 'reply',
      reply: 'What day works for you?',
      outcomeScore: 45,
      resolved: false,
      scoreReason: 'No concrete commitment',
    }

    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify(expected)),
      },
    })

    const agent = new RetentionAgent(deps)
    const result = await agent.evaluateTask('task-123')

    expect(result.action).toBe('reply')
    expect(result.outcomeScore).toBe(45)
    expect(result.resolved).toBe(false)
    expect(result.reply).toBe('What day works for you?')
  })

  it('extracts JSON even when Claude wraps it in prose', async () => {
    const inner: TaskEvaluation = {
      reasoning: 'Member committed',
      action: 'close',
      reply: 'See you Thursday!',
      outcomeScore: 90,
      resolved: true,
      scoreReason: 'Concrete commitment',
      outcome: 'engaged',
    }

    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue(
          `Here is my analysis:\n\n${JSON.stringify(inner)}\n\nLet me know if you need more.`
        ),
      },
    })

    const agent = new RetentionAgent(deps)
    const result = await agent.evaluateTask('task-123')

    expect(result.action).toBe('close')
    expect(result.outcome).toBe('engaged')
  })

  it('handles malformed JSON from Claude gracefully — returns escalate fallback', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockResolvedValue('This is not JSON at all, sorry!'),
      },
    })

    const agent = new RetentionAgent(deps)
    const result = await agent.evaluateTask('task-123')

    // Should fall back to escalate — safest option when AI fails
    expect(result.action).toBe('escalate')
    expect(result.resolved).toBe(false)
  })

  it('handles Claude throwing an error gracefully — returns escalate fallback', async () => {
    const deps = makeDeps({
      claude: {
        evaluate: vi.fn().mockRejectedValue(new Error('Claude API error')),
      },
    })

    const agent = new RetentionAgent(deps)
    const result = await agent.evaluateTask('task-123')

    expect(result.action).toBe('escalate')
    expect(result.resolved).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario-based tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RetentionAgent scenarios', () => {
  it('Vague reply ("I\'ll check the schedule") → action=reply, NOT close', async () => {
    const deps = makeDeps({
      db: {
        getTask: vi.fn().mockResolvedValue(makeTask()),
        updateTaskStatus: vi.fn(),
        appendConversation: vi.fn(),
        getConversationHistory: vi.fn().mockResolvedValue([
          makeConversationMsg('agent', "Hey Dan! We miss you in class."),
          makeConversationMsg('member', "I'll check the schedule."),
        ]),
        createOutboundMessage: vi.fn().mockResolvedValue(makeOutboundMessage()),
        updateOutboundMessageStatus: vi.fn(),
      },
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Vague reply with no commitment — keep conversation going',
          action: 'reply',
          reply: 'What day tends to work best for you?',
          outcomeScore: 30,
          resolved: false,
          scoreReason: 'No concrete commitment yet',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    const evaluation = await agent.evaluateTask('task-123')

    expect(evaluation.action).toBe('reply')
    expect(evaluation.action).not.toBe('close')
    expect(evaluation.resolved).toBe(false)
  })

  it('Explicit no ("not interested") → action=close, outcome=churned', async () => {
    const deps = makeDeps({
      db: {
        getTask: vi.fn().mockResolvedValue(makeTask()),
        updateTaskStatus: vi.fn(),
        appendConversation: vi.fn(),
        getConversationHistory: vi.fn().mockResolvedValue([
          makeConversationMsg('agent', "Hey Dan! We miss you in class."),
          makeConversationMsg('member', "not interested"),
        ]),
        createOutboundMessage: vi.fn().mockResolvedValue(makeOutboundMessage()),
        updateOutboundMessageStatus: vi.fn(),
      },
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Member explicitly declined — close gracefully',
          action: 'close',
          reply: "Totally understand! The door's always open if you change your mind.",
          outcomeScore: 10,
          resolved: true,
          scoreReason: 'Member declined',
          outcome: 'churned',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    const evaluation = await agent.evaluateTask('task-123')

    expect(evaluation.action).toBe('close')
    expect(evaluation.outcome).toBe('churned')
    expect(evaluation.resolved).toBe(true)
  })

  it('Explicit commitment ("I\'ll be there Thursday") → action=close, outcome=engaged', async () => {
    const deps = makeDeps({
      db: {
        getTask: vi.fn().mockResolvedValue(makeTask()),
        updateTaskStatus: vi.fn(),
        appendConversation: vi.fn(),
        getConversationHistory: vi.fn().mockResolvedValue([
          makeConversationMsg('agent', "Hey Dan! We miss you in class."),
          makeConversationMsg('member', "I'll be there Thursday"),
        ]),
        createOutboundMessage: vi.fn().mockResolvedValue(makeOutboundMessage()),
        updateOutboundMessageStatus: vi.fn(),
      },
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Member committed to specific day — success',
          action: 'close',
          reply: "Love to hear it! See you Thursday. 💪",
          outcomeScore: 90,
          resolved: true,
          scoreReason: 'Concrete commitment made',
          outcome: 'engaged',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    const evaluation = await agent.evaluateTask('task-123')

    expect(evaluation.action).toBe('close')
    expect(evaluation.outcome).toBe('engaged')
    expect(evaluation.outcomeScore).toBeGreaterThan(70)
  })

  it('Complaint ("I\'ve been waiting for a callback for weeks") → action=escalate', async () => {
    const deps = makeDeps({
      db: {
        getTask: vi.fn().mockResolvedValue(makeTask()),
        updateTaskStatus: vi.fn(),
        appendConversation: vi.fn(),
        getConversationHistory: vi.fn().mockResolvedValue([
          makeConversationMsg('agent', "Hey Dan! We miss you in class."),
          makeConversationMsg('member', "I've been waiting for a callback for weeks"),
        ]),
        createOutboundMessage: vi.fn().mockResolvedValue(makeOutboundMessage()),
        updateOutboundMessageStatus: vi.fn(),
      },
      claude: {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({
          reasoning: 'Member has a complaint about unresponsiveness — needs human attention',
          action: 'escalate',
          outcomeScore: 5,
          resolved: false,
          scoreReason: 'Service complaint — needs human',
        } satisfies TaskEvaluation)),
      },
    })

    const agent = new RetentionAgent(deps)
    const evaluation = await agent.evaluateTask('task-123')

    expect(evaluation.action).toBe('escalate')
    expect(evaluation.resolved).toBe(false)
  })
})
