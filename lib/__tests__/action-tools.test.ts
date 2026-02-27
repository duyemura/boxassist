/**
 * action-tools.test.ts
 *
 * Tests for action tools: approval logic, send_email safety rails,
 * request_input behavior per autonomy mode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockCreateTask = vi.fn().mockResolvedValue({ id: 'task-1' })
const mockUpdateTaskStatus = vi.fn().mockResolvedValue(undefined)

vi.mock('../db/tasks', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTaskStatus: (...args: unknown[]) => mockUpdateTaskStatus(...args),
}))

vi.mock('uuid', () => ({
  v4: () => 'reply-token-123',
}))

const mockSupabaseFrom = vi.fn()
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}))

vi.mock('../db/commands', () => ({
  insertCommand: vi.fn().mockResolvedValue({ id: 'cmd-1' }),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { actionToolGroup } from '../agents/tools/action-tools'
import type { ToolContext } from '../agents/tools/types'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    accountId: 'acct-001',
    apiKey: 'test-key',
    companyId: 'test-company',
    sessionId: 'session-001',
    autopilotLevel: 'smart',
    autonomyMode: 'semi_auto',
    workingSet: { processed: [], emailed: [], skipped: [] },
    ...overrides,
  }
}

function findTool(name: string) {
  const tool = actionToolGroup.tools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('action tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create_task', () => {
    it('creates a task and returns taskId', async () => {
      const tool = findTool('create_task')
      const result = await tool.execute(
        { task_type: 'churn_risk', goal: 'Check on Sarah', member_email: 'sarah@test.com' },
        makeCtx(),
      ) as any

      expect(result.taskId).toBe('task-1')
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acct-001',
          taskType: 'churn_risk',
          goal: 'Check on Sarah',
        }),
      )
    })

    it('never requires approval', () => {
      const tool = findTool('create_task')
      expect(tool.requiresApproval).toBe(false)
    })
  })

  describe('draft_message', () => {
    it('returns a draft without side effects', async () => {
      const tool = findTool('draft_message')
      const result = await tool.execute(
        { to_email: 'sarah@test.com', subject: 'Hi', body: 'Hello Sarah' },
        makeCtx(),
      ) as any

      expect(result.status).toBe('drafted')
      expect(result.draft.to).toBe('sarah@test.com')
      expect(result.draft.subject).toBe('Hi')
    })

    it('never requires approval', () => {
      expect(findTool('draft_message').requiresApproval).toBe(false)
    })
  })

  describe('send_email', () => {
    it('requires approval in semi_auto mode', () => {
      const tool = findTool('send_email')
      const ctx = makeCtx({ autonomyMode: 'semi_auto' })
      const requiresFn = tool.requiresApproval as Function
      expect(requiresFn({}, ctx)).toBe(true)
    })

    it('does NOT require approval in full_auto mode', () => {
      const tool = findTool('send_email')
      const ctx = makeCtx({ autonomyMode: 'full_auto' })
      const requiresFn = tool.requiresApproval as Function
      expect(requiresFn({}, ctx)).toBe(false)
    })

    it('checks daily send limit', async () => {
      const tool = findTool('send_email')

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ count: 10 }), // at limit
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await tool.execute(
        { to_email: 'test@test.com', subject: 'Hi', body: 'Hello' },
        makeCtx({ autonomyMode: 'full_auto' }),
      ) as any

      expect(result.error).toContain('Daily send limit')
    })

    it('checks opt-out list', async () => {
      const tool = findTool('send_email')

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ count: 0 }),
              }),
            }),
          }
        }
        if (table === 'communication_optouts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'opt-1' }, error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await tool.execute(
        { to_email: 'opted-out@test.com', subject: 'Hi', body: 'Hello' },
        makeCtx({ autonomyMode: 'full_auto' }),
      ) as any

      expect(result.error).toContain('opted out')
    })

    it('queues email and returns reply token on success', async () => {
      const tool = findTool('send_email')

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'outbound_messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockResolvedValue({ count: 0 }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'communication_optouts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      })

      const result = await tool.execute(
        { to_email: 'sarah@test.com', subject: 'Check in', body: 'Hey Sarah' },
        makeCtx({ autonomyMode: 'full_auto' }),
      ) as any

      expect(result.messageId).toBe('msg-1')
      expect(result.replyToken).toBe('reply-token-123')
      expect(result.status).toBe('queued')
    })
  })

  describe('close_task', () => {
    it('marks task as resolved', async () => {
      const tool = findTool('close_task')
      const result = await tool.execute(
        { task_id: 'task-1', outcome: 'engaged', reason: 'Member responded positively' },
        makeCtx(),
      ) as any

      expect(result.status).toBe('resolved')
      expect(mockUpdateTaskStatus).toHaveBeenCalledWith('task-1', 'resolved', expect.objectContaining({ outcome: 'engaged' }))
    })

    it('never requires approval', () => {
      expect(findTool('close_task').requiresApproval).toBe(false)
    })
  })

  describe('escalate', () => {
    it('escalates task and creates notification', async () => {
      const tool = findTool('escalate')

      mockSupabaseFrom.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'note-1' }, error: null }),
          }),
        }),
      })

      const result = await tool.execute(
        { task_id: 'task-1', reason: 'Member threatened legal action', member_name: 'John' },
        makeCtx(),
      ) as any

      expect(result.status).toBe('escalated')
      expect(mockUpdateTaskStatus).toHaveBeenCalledWith('task-1', 'escalated', expect.any(Object))
    })

    it('never requires approval', () => {
      expect(findTool('escalate').requiresApproval).toBe(false)
    })
  })

  describe('request_input', () => {
    it('auto-responds in full_auto mode', async () => {
      const tool = findTool('request_input')
      const result = await tool.execute(
        { question: 'Should I email this person?' },
        makeCtx({ autonomyMode: 'full_auto' }),
      ) as any

      expect(result.answer).toContain('Make your best judgment')
    })

    it('requires approval in semi_auto mode', () => {
      const tool = findTool('request_input')
      const requiresFn = tool.requiresApproval as Function
      expect(requiresFn({}, makeCtx({ autonomyMode: 'semi_auto' }))).toBe(true)
    })

    it('does NOT require approval in full_auto mode', () => {
      const tool = findTool('request_input')
      const requiresFn = tool.requiresApproval as Function
      expect(requiresFn({}, makeCtx({ autonomyMode: 'full_auto' }))).toBe(false)
    })
  })

  describe('tool group', () => {
    it('has 8 tools', () => {
      expect(actionToolGroup.tools).toHaveLength(8)
    })

    it('includes all expected tools', () => {
      const names = actionToolGroup.tools.map(t => t.name)
      expect(names).toEqual([
        'create_task', 'draft_message', 'send_email', 'wait_for_reply',
        'notify_owner', 'close_task', 'escalate', 'request_input',
      ])
    })
  })
})
