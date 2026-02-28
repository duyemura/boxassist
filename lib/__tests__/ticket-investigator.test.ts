/**
 * ticket-investigator.test.ts
 *
 * Tests for the AI-powered ticket investigation agent.
 * After a bug/error ticket is created, this module analyzes the bug
 * and posts a structured investigation comment on the Linear ticket.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate }
    },
  }
})

const mockCommentOnIssue = vi.fn()
const mockUpdateIssue = vi.fn()
vi.mock('../linear', () => ({
  commentOnIssue: (...args: unknown[]) => mockCommentOnIssue(...args),
  updateIssueState: (...args: unknown[]) => mockUpdateIssue(...args),
}))

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ticket-investigator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('calls Claude HAIKU with bug context and codebase map', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '## Investigation\nLikely in AgentChat.tsx' }],
      usage: { input_tokens: 500, output_tokens: 200 },
    })
    mockCommentOnIssue.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-001',
      issueIdentifier: 'AGT-7',
      title: '[bug] Chat only shows user messages',
      description: 'When clicking on old chat, only shows messages I sent',
      pageUrl: 'http://localhost:3000/dashboard',
      navigationHistory: ['/dashboard/improvements'],
    })

    // Should call Claude
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const callArgs = mockCreate.mock.calls[0][0]

    // Should use HAIKU model
    expect(callArgs.model).toBe('claude-haiku-4-5-20251001')

    // System prompt should contain codebase context
    expect(callArgs.system).toContain('software engineer')

    // User message should contain the bug details
    const userMsg = callArgs.messages[0].content
    expect(userMsg).toContain('Chat only shows user messages')
    expect(userMsg).toContain('/dashboard')
  })

  it('posts investigation comment on the Linear ticket', async () => {
    const analysisText = [
      '## Likely Files',
      '- `components/AgentChat.tsx` — chat display component',
      '- `app/api/agents/runs/[sessionId]/route.ts` — session loading endpoint',
      '',
      '## Root Cause Hypothesis',
      'The `reconstructMessages()` function may not be handling assistant messages correctly.',
      '',
      '## Investigation Steps',
      '1. Check reconstructMessages() for assistant role handling',
      '2. Verify messages are being saved to agent_sessions table',
    ].join('\n')

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: analysisText }],
      usage: { input_tokens: 500, output_tokens: 300 },
    })
    mockCommentOnIssue.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-001',
      issueIdentifier: 'AGT-7',
      title: '[bug] Chat only shows user messages',
      description: 'When clicking on old chat, only shows messages I sent',
    })

    // Should post comment with investigation header
    expect(mockCommentOnIssue).toHaveBeenCalledTimes(1)
    const [issueId, body] = mockCommentOnIssue.mock.calls[0]
    expect(issueId).toBe('issue-001')
    expect(body).toContain('AI Investigation')
    expect(body).toContain('AgentChat.tsx')
    expect(body).toContain('reconstructMessages()')
  })

  it('includes page URL and navigation in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Investigation results' }],
      usage: { input_tokens: 400, output_tokens: 150 },
    })
    mockCommentOnIssue.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-002',
      issueIdentifier: 'AGT-8',
      title: '[bug] Setup page crashes',
      description: 'Setup wizard crashes when selecting agent',
      pageUrl: 'http://localhost:3000/setup',
      navigationHistory: ['/dashboard', '/setup'],
    })

    const userMsg = mockCreate.mock.calls[0][0].messages[0].content
    expect(userMsg).toContain('/setup')
    expect(userMsg).toContain('/dashboard')
  })

  it('handles Claude API errors gracefully', async () => {
    mockCreate.mockRejectedValue(new Error('API error'))

    const { investigateTicket } = await import('../ticket-investigator')

    // Should not throw
    await expect(
      investigateTicket({
        issueId: 'issue-003',
        issueIdentifier: 'AGT-9',
        title: '[bug] Something broke',
        description: 'Something broke',
      }),
    ).resolves.not.toThrow()

    // Should not post a comment
    expect(mockCommentOnIssue).not.toHaveBeenCalled()
  })

  it('handles empty Claude response gracefully', async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 400, output_tokens: 0 },
    })

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-004',
      issueIdentifier: 'AGT-10',
      title: '[bug] Edge case',
      description: 'Something weird',
    })

    // Should not post an empty comment
    expect(mockCommentOnIssue).not.toHaveBeenCalled()
  })

  it('skips investigation when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-005',
      issueIdentifier: 'AGT-11',
      title: '[bug] No API key',
      description: 'Should skip',
    })

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCommentOnIssue).not.toHaveBeenCalled()
  })

  it('includes screenshot URL in prompt when available', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Investigation' }],
      usage: { input_tokens: 400, output_tokens: 100 },
    })
    mockCommentOnIssue.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-006',
      issueIdentifier: 'AGT-12',
      title: '[bug] Visual glitch',
      description: 'Chart renders wrong',
      screenshotUrl: 'https://storage.example.com/shot.png',
    })

    const userMsg = mockCreate.mock.calls[0][0].messages[0].content
    expect(userMsg).toContain('screenshot')
  })
})

