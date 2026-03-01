/**
 * ticket-investigator.test.ts
 *
 * Tests for the AI-powered ticket investigation agent.
 * After a ticket is created (bug, feature, or suggestion), this module
 * analyzes it and posts a structured investigation comment on Linear.
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
const mockUpdateIssueState = vi.fn()
vi.mock('../linear', () => ({
  commentOnIssue: (...args: unknown[]) => mockCommentOnIssue(...args),
  updateIssueState: (...args: unknown[]) => mockUpdateIssueState(...args),
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
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-001',
      issueIdentifier: 'AGT-7',
      title: '[bug] Chat only shows user messages',
      description: 'When clicking on old chat, only shows messages I sent',
      ticketType: 'bug',
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

    // Should transition to backlog after investigation
    expect(mockUpdateIssueState).toHaveBeenCalledWith('issue-001', 'backlog')
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
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-001',
      issueIdentifier: 'AGT-7',
      title: '[bug] Chat only shows user messages',
      description: 'When clicking on old chat, only shows messages I sent',
      ticketType: 'bug',
    })

    // Should post comment with investigation header
    expect(mockCommentOnIssue).toHaveBeenCalledTimes(1)
    const [issueId, body] = mockCommentOnIssue.mock.calls[0]
    expect(issueId).toBe('issue-001')
    expect(body).toContain('AI Investigation')
    expect(body).toContain('AgentChat.tsx')
    expect(body).toContain('reconstructMessages()')

    // Should transition to backlog after posting investigation
    expect(mockUpdateIssueState).toHaveBeenCalledWith('issue-001', 'backlog')
  })

  it('includes page URL and navigation in the prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Investigation results' }],
      usage: { input_tokens: 400, output_tokens: 150 },
    })
    mockCommentOnIssue.mockResolvedValue(true)
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-002',
      issueIdentifier: 'AGT-8',
      title: '[bug] Setup page crashes',
      description: 'Setup wizard crashes when selecting agent',
      ticketType: 'bug',
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
        ticketType: 'bug',
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
      ticketType: 'bug',
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
      ticketType: 'bug',
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
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-006',
      issueIdentifier: 'AGT-12',
      title: '[bug] Visual glitch',
      description: 'Chart renders wrong',
      ticketType: 'bug',
      screenshotUrl: 'https://storage.example.com/shot.png',
    })

    const userMsg = mockCreate.mock.calls[0][0].messages[0].content
    expect(userMsg).toContain('screenshot')
  })

  it('uses feature system prompt for feature tickets', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '## Implementation Approach\nAdd delete button' }],
      usage: { input_tokens: 500, output_tokens: 200 },
    })
    mockCommentOnIssue.mockResolvedValue(true)
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-feat-1',
      issueIdentifier: 'AGT-20',
      title: '[feedback] Need a way to delete a convo',
      description: 'Need a way to delete a convo',
      ticketType: 'feature',
      pageUrl: 'http://localhost:3000/dashboard',
    })

    const callArgs = mockCreate.mock.calls[0][0]
    // Feature prompt should mention implementation approach, not root cause
    expect(callArgs.system).toContain('feature request')
    expect(callArgs.system).toContain('Implementation Approach')
    expect(callArgs.system).not.toContain('Root Cause')

    // User message should label it as Feature Request
    const userMsg = callArgs.messages[0].content
    expect(userMsg).toContain('Feature Request')
    expect(userMsg).toContain('delete a convo')
  })

  it('uses feature system prompt for suggestion tickets', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '## Relevant Files\n- components/AgentChat.tsx' }],
      usage: { input_tokens: 400, output_tokens: 150 },
    })
    mockCommentOnIssue.mockResolvedValue(true)
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-sug-1',
      issueIdentifier: 'AGT-21',
      title: '[suggestion] Add keyboard shortcuts',
      description: 'Would be nice to have keyboard shortcuts for common actions',
      ticketType: 'suggestion',
    })

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system).toContain('feature request')
    expect(callArgs.messages[0].content).toContain('Feature Request')
  })

  it('uses bug system prompt for bug tickets', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '## Root Cause\nSomething broke' }],
      usage: { input_tokens: 400, output_tokens: 150 },
    })
    mockCommentOnIssue.mockResolvedValue(true)
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-bug-1',
      issueIdentifier: 'AGT-22',
      title: '[bug] Page crashes',
      description: 'Page crashes on load',
      ticketType: 'bug',
    })

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system).toContain('bug report')
    expect(callArgs.system).toContain('Root Cause')
    expect(callArgs.messages[0].content).toContain('Bug Report')
  })

  it('defaults to feature prompt when ticketType is undefined', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Analysis' }],
      usage: { input_tokens: 400, output_tokens: 100 },
    })
    mockCommentOnIssue.mockResolvedValue(true)
    mockUpdateIssueState.mockResolvedValue(true)

    const { investigateTicket } = await import('../ticket-investigator')
    await investigateTicket({
      issueId: 'issue-no-type',
      issueIdentifier: 'AGT-23',
      title: 'Some ticket',
      description: 'No type specified',
    })

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system).toContain('feature request')
  })
})
