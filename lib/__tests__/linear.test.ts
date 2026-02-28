/**
 * linear.test.ts
 *
 * Tests for the Linear integration (lib/linear.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @linear/sdk ────────────────────────────────────────────────────────

const mockIssueCreate = vi.fn()
const mockIssueUpdate = vi.fn()
const mockIssueLabels = vi.fn()
const mockCreateIssueLabel = vi.fn()
const mockCreateComment = vi.fn()
const mockTeams = vi.fn()
const mockTeam = vi.fn()
const mockOrganization = { name: 'GymAgents Dev' }

vi.mock('@linear/sdk', () => {
  return {
    LinearClient: class MockLinearClient {
      createIssue = mockIssueCreate
      updateIssue = mockIssueUpdate
      issueLabels = mockIssueLabels
      createIssueLabel = mockCreateIssueLabel
      createComment = mockCreateComment
      teams = mockTeams
      team = mockTeam
      organization = mockOrganization
    },
  }
})

// Mock the ticket investigator (fire-and-forget, don't actually call Claude)
vi.mock('../ticket-investigator', () => ({
  investigateTicket: vi.fn().mockResolvedValue(undefined),
}))

// ── Tests ───────────────────────────────────────────────────────────────────

describe('linear integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.LINEAR_API_KEY = 'lin_test_key'
    process.env.LINEAR_TEAM_ID = 'team-001'
  })

  it('returns null when LINEAR_API_KEY is not set', async () => {
    delete process.env.LINEAR_API_KEY
    const { createFeedbackIssue } = await import('../linear')
    const result = await createFeedbackIssue({
      type: 'bug',
      message: 'Something broke',
    })
    expect(result).toBeNull()
  })

  it('returns null when LINEAR_TEAM_ID is not set', async () => {
    delete process.env.LINEAR_TEAM_ID
    const { createFeedbackIssue } = await import('../linear')
    const result = await createFeedbackIssue({
      type: 'bug',
      message: 'Something broke',
    })
    expect(result).toBeNull()
  })

  it('creates an issue with correct title and priority', async () => {
    const mockIssue = {
      id: 'issue-001',
      identifier: 'GA-1',
      url: 'https://linear.app/gymagents/issue/GA-1',
    }
    mockIssueLabels.mockResolvedValue({ nodes: [] })
    mockCreateIssueLabel.mockResolvedValue({ issueLabel: { id: 'label-1' } })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    const result = await createFeedbackIssue({
      type: 'bug',
      message: 'Button does not work on dashboard',
    })

    expect(result).toEqual({
      id: 'issue-001',
      identifier: 'GA-1',
      url: 'https://linear.app/gymagents/issue/GA-1',
    })

    // Check createIssue was called with bug priority (2 = High)
    // Bug titles now use area tag [General] instead of [bug]
    expect(mockIssueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-001',
        priority: 2,
        title: expect.stringContaining('Button does not work'),
      }),
    )
  })

  it('includes screenshot in description when provided', async () => {
    const mockIssue = { id: 'i2', identifier: 'GA-2', url: 'https://linear.app/ga/GA-2' }
    mockIssueLabels.mockResolvedValue({ nodes: [{ id: 'existing-label' }] })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({
      type: 'feedback',
      message: 'Looks good',
      screenshotUrl: 'https://storage.example.com/shot.png',
    })

    const callArg = mockIssueCreate.mock.calls[0][0]
    expect(callArg.description).toContain('![Screenshot](https://storage.example.com/shot.png)')
  })

  it('maps suggestion type to low priority', async () => {
    const mockIssue = { id: 'i3', identifier: 'GA-3', url: 'https://linear.app/ga/GA-3' }
    mockIssueLabels.mockResolvedValue({ nodes: [] })
    mockCreateIssueLabel.mockResolvedValue({ issueLabel: { id: 'l3' } })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({ type: 'suggestion', message: 'Add dark mode' })

    expect(mockIssueCreate).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 4 }), // Low
    )
  })

  it('reuses existing labels instead of creating new ones', async () => {
    const mockIssue = { id: 'i4', identifier: 'GA-4', url: 'https://linear.app/ga/GA-4' }
    // Bug tickets now get: type label + area label + needs-investigation
    // All share the same existing label for this test
    mockIssueLabels.mockResolvedValue({ nodes: [{ id: 'existing-bug-label' }] })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({ type: 'bug', message: 'Crash' })

    // Should NOT have called createLabel since labels already exist
    expect(mockCreateIssueLabel).not.toHaveBeenCalled()
    // Bug tickets now include multiple labels (bug + area + needs-investigation)
    const callArg = mockIssueCreate.mock.calls[0][0]
    expect(callArg.labelIds).toContain('existing-bug-label')
    expect(callArg.labelIds.length).toBeGreaterThanOrEqual(1)
  })

  it('handles API errors gracefully', async () => {
    mockIssueLabels.mockResolvedValue({ nodes: [] })
    mockCreateIssueLabel.mockResolvedValue({ issueLabel: { id: 'l-err' } })
    mockIssueCreate.mockRejectedValue(new Error('Network error'))

    const { createFeedbackIssue } = await import('../linear')
    const result = await createFeedbackIssue({ type: 'error', message: 'Server crash' })

    expect(result).toBeNull()
  })

  it('uses structured ticket for errors with stack traces', async () => {
    const mockIssue = { id: 'i-structured', identifier: 'GA-10', url: 'https://linear.app/ga/GA-10' }
    mockIssueLabels.mockResolvedValue({ nodes: [{ id: 'existing-label' }] })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({
      type: 'error',
      message: "TypeError: Cannot read properties of undefined (reading 'map')",
      url: 'http://localhost:3000/dashboard',
      screenshotUrl: 'https://storage.example.com/shot.png',
      metadata: {
        stack: `TypeError: Cannot read properties of undefined (reading 'map')
    at AgentList (webpack-internal:///./components/AgentList.tsx:45:22)
    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:16305:18)`,
        viewport: { width: 1440, height: 900 },
        navigationHistory: ['/setup', '/dashboard'],
      },
    })

    const callArg = mockIssueCreate.mock.calls[0][0]

    // Title should have area tag, not generic [error]
    expect(callArg.title).toContain('[Dashboard]')
    expect(callArg.title).toContain('undefined')

    // Description should be structured with sections
    expect(callArg.description).toContain('## What happens')
    expect(callArg.description).toContain('## Technical context')
    expect(callArg.description).toContain('`components/AgentList.tsx:45`')
    expect(callArg.description).toContain('## Red test sketch')
    expect(callArg.description).toContain('## Triage')
    expect(callArg.description).toContain('auto-fixable')
    expect(callArg.description).toContain('![Screenshot]')

    // Priority should be High (2) for auto-fixable bug
    expect(callArg.priority).toBe(2)
  })

  it('uses area-tagged title for bugs without stack traces', async () => {
    const mockIssue = { id: 'i-simple', identifier: 'GA-11', url: 'https://linear.app/ga/GA-11' }
    mockIssueLabels.mockResolvedValue({ nodes: [{ id: 'existing-label' }] })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({
      type: 'bug',
      message: 'The dashboard chart looks wrong after timezone change',
    })

    const callArg = mockIssueCreate.mock.calls[0][0]

    // Bug titles now use area classification (General when no URL)
    expect(callArg.title).toContain('[General]')
    // Should have structured sections for bugs
    expect(callArg.description).toContain('## What happens')
    expect(callArg.description).toContain('## Triage')
    expect(callArg.description).toContain('pending AI investigation')
    // No red test sketch (that's for stack-trace tickets)
    expect(callArg.description).not.toContain('## Red test sketch')
    expect(callArg.priority).toBe(2) // High for bugs
  })

  it('classifies area from page URL for bugs', async () => {
    const mockIssue = { id: 'i-area', identifier: 'GA-12', url: 'https://linear.app/ga/GA-12' }
    mockIssueLabels.mockResolvedValue({ nodes: [{ id: 'existing-label' }] })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({
      type: 'bug',
      message: 'Chat only shows my messages, not agent replies',
      url: 'http://localhost:3000/dashboard',
      metadata: {
        navigationHistory: ['/dashboard/improvements'],
        viewport: { width: 1484, height: 897 },
      },
    })

    const callArg = mockIssueCreate.mock.calls[0][0]

    // Should classify as Dashboard from the URL
    expect(callArg.title).toContain('[Dashboard]')
    expect(callArg.description).toContain('## What happens')
    expect(callArg.description).toContain('## Technical context')
    expect(callArg.description).toContain('Dashboard')
  })

  it('fires AI investigation for bug tickets', async () => {
    const mockIssue = { id: 'i-investigate', identifier: 'GA-13', url: 'https://linear.app/ga/GA-13' }
    mockIssueLabels.mockResolvedValue({ nodes: [{ id: 'existing-label' }] })
    mockIssueCreate.mockResolvedValue({ issue: mockIssue })

    const { createFeedbackIssue } = await import('../linear')
    await createFeedbackIssue({
      type: 'bug',
      message: 'Something is broken',
      url: 'http://localhost:3000/dashboard',
    })

    // The investigation is fire-and-forget, so we just verify the ticket was created
    expect(mockIssueCreate).toHaveBeenCalled()
    const callArg = mockIssueCreate.mock.calls[0][0]
    expect(callArg.description).toContain('pending AI investigation')
  })

  it('validates connection successfully', async () => {
    mockTeams.mockResolvedValue({
      nodes: [
        { id: 't1', name: 'Engineering', key: 'ENG' },
        { id: 't2', name: 'Product', key: 'PRD' },
      ],
    })

    const { validateLinearConnection } = await import('../linear')
    const result = await validateLinearConnection()

    expect(result.ok).toBe(true)
    expect(result.workspace).toBe('GymAgents Dev')
    expect(result.teams).toHaveLength(2)
  })
})

// ── Lifecycle hooks ─────────────────────────────────────────────────────────

describe('linear lifecycle hooks', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.LINEAR_API_KEY = 'lin_test_key'
    process.env.LINEAR_TEAM_ID = 'team-001'
  })

  // ── getWorkflowStates ───────────────────────────────────────────────────

  describe('getWorkflowStates', () => {
    it('returns workflow states for the configured team', async () => {
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: 'st-1', name: 'Backlog', type: 'backlog' },
            { id: 'st-2', name: 'In Progress', type: 'started' },
            { id: 'st-3', name: 'Done', type: 'completed' },
            { id: 'st-4', name: 'Cancelled', type: 'canceled' },
          ],
        }),
      })

      const { getWorkflowStates } = await import('../linear')
      const states = await getWorkflowStates()

      expect(states).not.toBeNull()
      expect(states!.backlog).toBe('st-1')
      expect(states!.inProgress).toBe('st-2')
      expect(states!.done).toBe('st-3')
      expect(states!.cancelled).toBe('st-4')
    })

    it('returns null when Linear is not configured', async () => {
      delete process.env.LINEAR_API_KEY
      const { getWorkflowStates } = await import('../linear')
      const states = await getWorkflowStates()
      expect(states).toBeNull()
    })

    it('caches states after first fetch', async () => {
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: 'st-1', name: 'Backlog', type: 'backlog' },
            { id: 'st-2', name: 'In Progress', type: 'started' },
            { id: 'st-3', name: 'Done', type: 'completed' },
          ],
        }),
      })

      const { getWorkflowStates } = await import('../linear')
      await getWorkflowStates()
      await getWorkflowStates()

      // team() should only be called once due to caching
      expect(mockTeam).toHaveBeenCalledTimes(1)
    })
  })

  // ── updateIssueState ────────────────────────────────────────────────────

  describe('updateIssueState', () => {
    it('transitions an issue to In Progress', async () => {
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: 'st-1', name: 'Backlog', type: 'backlog' },
            { id: 'st-2', name: 'In Progress', type: 'started' },
            { id: 'st-3', name: 'Done', type: 'completed' },
          ],
        }),
      })
      mockIssueUpdate.mockResolvedValue({ success: true })

      const { updateIssueState } = await import('../linear')
      const result = await updateIssueState('issue-123', 'inProgress')

      expect(result).toBe(true)
      expect(mockIssueUpdate).toHaveBeenCalledWith('issue-123', { stateId: 'st-2' })
    })

    it('transitions an issue to Done', async () => {
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: 'st-1', name: 'Backlog', type: 'backlog' },
            { id: 'st-2', name: 'In Progress', type: 'started' },
            { id: 'st-3', name: 'Done', type: 'completed' },
          ],
        }),
      })
      mockIssueUpdate.mockResolvedValue({ success: true })

      const { updateIssueState } = await import('../linear')
      const result = await updateIssueState('issue-456', 'done')

      expect(result).toBe(true)
      expect(mockIssueUpdate).toHaveBeenCalledWith('issue-456', { stateId: 'st-3' })
    })

    it('returns false when Linear is not configured', async () => {
      delete process.env.LINEAR_API_KEY
      const { updateIssueState } = await import('../linear')
      const result = await updateIssueState('issue-123', 'inProgress')
      expect(result).toBe(false)
    })

    it('returns false on API error', async () => {
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: 'st-2', name: 'In Progress', type: 'started' },
          ],
        }),
      })
      mockIssueUpdate.mockRejectedValue(new Error('API error'))

      const { updateIssueState } = await import('../linear')
      const result = await updateIssueState('issue-123', 'inProgress')
      expect(result).toBe(false)
    })
  })

  // ── commentOnIssue ──────────────────────────────────────────────────────

  describe('commentOnIssue', () => {
    it('posts a markdown comment on an issue', async () => {
      mockCreateComment.mockResolvedValue({
        comment: { id: 'comment-1', body: 'Test passed' },
      })

      const { commentOnIssue } = await import('../linear')
      const result = await commentOnIssue('issue-123', '## RED ✅\nTest fails as expected')

      expect(result).toBe(true)
      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: 'issue-123',
        body: '## RED ✅\nTest fails as expected',
      })
    })

    it('returns false when Linear is not configured', async () => {
      delete process.env.LINEAR_API_KEY
      const { commentOnIssue } = await import('../linear')
      const result = await commentOnIssue('issue-123', 'comment body')
      expect(result).toBe(false)
    })

    it('returns false on API error', async () => {
      mockCreateComment.mockRejectedValue(new Error('Network error'))

      const { commentOnIssue } = await import('../linear')
      const result = await commentOnIssue('issue-123', 'comment body')
      expect(result).toBe(false)
    })
  })

  // ── documentFixProgress ─────────────────────────────────────────────────

  describe('documentFixProgress', () => {
    it('posts red test result as a formatted comment', async () => {
      mockCreateComment.mockResolvedValue({ comment: { id: 'c-1' } })

      const { documentFixProgress } = await import('../linear')
      await documentFixProgress('issue-123', 'red', {
        testFile: 'lib/__tests__/integrations.test.ts',
        testName: 'returns clean JSON error when Composio throws',
        output: 'FAIL: expected 500, got undefined',
      })

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: 'issue-123',
        body: expect.stringContaining('RED'),
      })
      const body = mockCreateComment.mock.calls[0][0].body
      expect(body).toContain('integrations.test.ts')
      expect(body).toContain('returns clean JSON error when Composio throws')
      expect(body).toContain('FAIL: expected 500, got undefined')
    })

    it('posts green test result', async () => {
      mockCreateComment.mockResolvedValue({ comment: { id: 'c-2' } })

      const { documentFixProgress } = await import('../linear')
      await documentFixProgress('issue-123', 'green', {
        testFile: 'lib/__tests__/integrations.test.ts',
        testName: 'returns clean JSON error when Composio throws',
        totalTests: 722,
        totalPassing: 722,
      })

      const body = mockCreateComment.mock.calls[0][0].body
      expect(body).toContain('GREEN')
      expect(body).toContain('722')
      expect(body).toContain('all pass')
    })

    it('posts PR created event', async () => {
      mockCreateComment.mockResolvedValue({ comment: { id: 'c-3' } })

      const { documentFixProgress } = await import('../linear')
      await documentFixProgress('issue-123', 'pr', {
        prUrl: 'https://github.com/duyemura/gymagents/pull/2',
        prTitle: 'fix: handle Composio auth error gracefully (AGT-4)',
        branch: 'fix/AGT-4-composio-error',
      })

      const body = mockCreateComment.mock.calls[0][0].body
      expect(body).toContain('PR Created')
      expect(body).toContain('https://github.com/duyemura/gymagents/pull/2')
      expect(body).toContain('fix/AGT-4-composio-error')
    })

    it('posts fix deployed event and transitions to Done', async () => {
      mockCreateComment.mockResolvedValue({ comment: { id: 'c-4' } })
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: 'st-3', name: 'Done', type: 'completed' },
          ],
        }),
      })
      mockIssueUpdate.mockResolvedValue({ success: true })

      const { documentFixProgress } = await import('../linear')
      await documentFixProgress('issue-123', 'deployed', {
        prUrl: 'https://github.com/duyemura/gymagents/pull/2',
        deployUrl: 'https://app-orcin-one-70.vercel.app',
      })

      const body = mockCreateComment.mock.calls[0][0].body
      expect(body).toContain('Deployed')
      expect(body).toContain('app-orcin-one-70.vercel.app')

      // Should also transition to Done
      expect(mockIssueUpdate).toHaveBeenCalledWith('issue-123', { stateId: 'st-3' })
    })
  })
})
