/**
 * handle-reply.test.ts
 *
 * Tests for lib/handle-reply.ts — the shared inbound reply handler.
 * Covers:
 *   - handleInboundReply: task lookup, routing to RetentionAgent, skip conditions
 *   - stripQuotedReply: email quote stripping
 *   - stripHtml: HTML tag removal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetTask = vi.fn()
const mockUpdateTaskStatus = vi.fn()
const mockAppendConversation = vi.fn()
const mockGetConversationHistory = vi.fn().mockResolvedValue([])
const mockCreateOutboundMessage = vi.fn().mockResolvedValue({ id: 'msg-1' })
const mockUpdateOutboundMessageStatus = vi.fn()
const mockPublishEvent = vi.fn().mockResolvedValue('evt-1')

vi.mock('../db/tasks', () => ({
  getTask: (...args: any[]) => mockGetTask(...args),
  updateTaskStatus: (...args: any[]) => mockUpdateTaskStatus(...args),
  appendConversation: (...args: any[]) => mockAppendConversation(...args),
  getConversationHistory: (...args: any[]) => mockGetConversationHistory(...args),
}))

vi.mock('../db/events', () => ({
  publishEvent: (...args: any[]) => mockPublishEvent(...args),
}))

vi.mock('../db/commands', () => ({
  createOutboundMessage: (...args: any[]) => mockCreateOutboundMessage(...args),
  updateOutboundMessageStatus: (...args: any[]) => mockUpdateOutboundMessageStatus(...args),
}))

// Mock Resend
vi.mock('resend', () => {
  class MockResend {
    emails = {
      send: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
    }
  }
  return { Resend: MockResend }
})

// Mock Anthropic (used by RetentionAgent via deps.claude)
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            reasoning: 'Member replied positively',
            action: 'reply',
            reply: 'Great to hear!',
            outcomeScore: 50,
            resolved: false,
            scoreReason: 'Conversation ongoing',
          }),
        }],
      }),
    }
  }
  return { default: MockAnthropic }
})

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeTask = (overrides: Record<string, any> = {}) => ({
  id: 'task-uuid-123',
  gym_id: 'gym-001',
  assigned_agent: 'retention',
  task_type: 'churn_risk',
  member_email: 'dan@example.com',
  member_name: 'Dan',
  goal: 'Re-engage member',
  context: {},
  status: 'awaiting_reply',
  outcome: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  ...overrides,
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('handleInboundReply', () => {
  let handleInboundReply: typeof import('../handle-reply').handleInboundReply

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetTask.mockResolvedValue(makeTask())
    mockGetConversationHistory.mockResolvedValue([
      { id: 'msg-1', task_id: 'task-uuid-123', gym_id: 'gym-001', role: 'agent', content: 'Hey Dan!', agent_name: 'retention', evaluation: null, created_at: '2026-02-01T00:00:00Z' },
    ])
    const mod = await import('../handle-reply')
    handleInboundReply = mod.handleInboundReply
  })

  it('returns processed=false when task is not found', async () => {
    mockGetTask.mockResolvedValue(null)

    const result = await handleInboundReply({
      replyToken: 'nonexistent-uuid',
      memberReply: 'Hello!',
      memberEmail: 'dan@example.com',
      memberName: 'Dan',
    })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('task_not_found')
  })

  it('returns processed=false when task is already resolved', async () => {
    mockGetTask.mockResolvedValue(makeTask({ status: 'resolved' }))

    const result = await handleInboundReply({
      replyToken: 'task-uuid-123',
      memberReply: 'Hello!',
      memberEmail: 'dan@example.com',
      memberName: 'Dan',
    })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('task_already_resolved')
  })

  it('returns processed=false when task is cancelled', async () => {
    mockGetTask.mockResolvedValue(makeTask({ status: 'cancelled' }))

    const result = await handleInboundReply({
      replyToken: 'task-uuid-123',
      memberReply: 'Hello!',
      memberEmail: 'dan@example.com',
      memberName: 'Dan',
    })

    expect(result.processed).toBe(false)
    expect(result.reason).toBe('task_already_cancelled')
  })

  it('routes reply to RetentionAgent and returns processed=true', async () => {
    const result = await handleInboundReply({
      replyToken: 'task-uuid-123',
      memberReply: "I'll be there Thursday",
      memberEmail: 'dan@example.com',
      memberName: 'Dan',
    })

    expect(result.processed).toBe(true)
    expect(result.taskId).toBe('task-uuid-123')
  })

  it('looks up task by replyToken (which is the task UUID)', async () => {
    await handleInboundReply({
      replyToken: 'task-uuid-123',
      memberReply: 'Hello',
      memberEmail: 'dan@example.com',
      memberName: 'Dan',
    })

    expect(mockGetTask).toHaveBeenCalledWith('task-uuid-123')
  })
})

// ── stripQuotedReply ─────────────────────────────────────────────────────────

describe('stripQuotedReply', () => {
  let stripQuotedReply: typeof import('../handle-reply').stripQuotedReply

  beforeEach(async () => {
    const mod = await import('../handle-reply')
    stripQuotedReply = mod.stripQuotedReply
  })

  it('extracts reply text above "On ... wrote:" quote marker', () => {
    const text = "I'll be there Thursday!\n\nOn Mon, Feb 10 2026, GymAgents wrote:\n> Hey Dan! Haven't seen you in a while..."
    const result = stripQuotedReply(text)
    expect(result).toContain("I'll be there Thursday")
    expect(result).not.toContain('wrote:')
  })

  it('extracts reply text above "-----Original Message-----"', () => {
    const text = "Sounds good, see you soon.\n\n-----Original Message-----\nFrom: gym@example.com"
    const result = stripQuotedReply(text)
    expect(result).toContain('Sounds good')
    expect(result).not.toContain('Original Message')
  })

  it('strips > quoted lines', () => {
    const text = "I'm coming back!\n> Hey Dan, we miss you\n> How about Thursday?"
    const result = stripQuotedReply(text)
    expect(result).toContain("I'm coming back")
    expect(result).not.toContain('How about Thursday')
  })

  it('returns empty string for empty input', () => {
    expect(stripQuotedReply('')).toBe('')
  })

  it('strips HTML tags before processing', () => {
    const text = '<p>I\'ll be there!</p>\n\nOn Feb 10, Agent wrote:\n<blockquote>Hey Dan</blockquote>'
    const result = stripQuotedReply(text)
    expect(result).toContain("I'll be there")
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<blockquote>')
  })

  it('returns full text when no quote markers present', () => {
    const text = 'Yes, coming in tomorrow!'
    const result = stripQuotedReply(text)
    expect(result).toContain('Yes, coming in tomorrow')
  })
})

// ── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  let stripHtml: typeof import('../handle-reply').stripHtml

  beforeEach(async () => {
    const mod = await import('../handle-reply')
    stripHtml = mod.stripHtml
  })

  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('collapses whitespace', () => {
    expect(stripHtml('<div>Hello</div>   <div>World</div>')).toBe('Hello World')
  })

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('')
  })

  it('handles self-closing tags', () => {
    expect(stripHtml('Hello<br/>World')).toBe('Hello World')
  })
})
