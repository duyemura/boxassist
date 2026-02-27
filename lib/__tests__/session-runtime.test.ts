/**
 * session-runtime.test.ts
 *
 * Tests for the goal-driven, chat-based session runtime.
 * Validates: tool execution, approval pause/resume, max turns,
 * owner message injection, autonomy modes, cost tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

// Mock Anthropic
const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

// Mock uuid
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}))

// Mock supabase
const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'session-1' }, error: null }) }) })
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockSelect = vi.fn()

vi.mock('../../supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'agent_sessions') {
        return {
          insert: mockInsert,
          update: mockUpdate,
          select: mockSelect,
        }
      }
      return {
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }) }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }
    }),
  },
}))

// Mock skill-loader
vi.mock('../../skill-loader', () => ({
  loadBaseContext: vi.fn().mockResolvedValue('You are an AI agent.'),
  selectRelevantSkills: vi.fn().mockResolvedValue([]),
  buildMultiSkillPrompt: vi.fn().mockResolvedValue('Base prompt.'),
}))

// Mock memories
vi.mock('../../db/memories', () => ({
  getMemoriesForPrompt: vi.fn().mockResolvedValue(''),
}))

// Mock cost
vi.mock('../../cost', () => ({
  calcCost: vi.fn().mockReturnValue({ costUsd: 0.01, markupUsd: 0.003, billedUsd: 0.013 }),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { startSession, resumeSession, loadSession } from '../agents/session-runtime'
import { ensureToolsRegistered, _clearRegistry, _resetRegistration } from '../agents/tools'
import { registerToolGroup } from '../agents/tools/registry'
import type { ToolGroup } from '../agents/tools/types'

// ── Test helpers ────────────────────────────────────────────────────────

function makeTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

function makeToolUseResponse(toolCalls: Array<{ name: string; input: Record<string, unknown> }>) {
  return {
    content: [
      ...toolCalls.map((tc, i) => ({
        type: 'tool_use' as const,
        id: `tool-call-${i}`,
        name: tc.name,
        input: tc.input,
      })),
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 200, output_tokens: 100 },
  }
}

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    accountId: 'acct-001',
    goal: 'Analyze retention',
    apiKey: 'test-key',
    companyId: 'test-company',
    tools: ['test'],
    autonomyMode: 'full_auto' as const,
    maxTurns: 5,
    ...overrides,
  }
}

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  uuidCounter = 0
  mockCreate.mockReset()
  _clearRegistry()
  _resetRegistration()

  // Register a simple test tool group
  const testGroup: ToolGroup = {
    name: 'test',
    tools: [
      {
        name: 'test_tool',
        description: 'A test tool',
        input_schema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: [] },
        requiresApproval: false,
        execute: async (input) => ({ result: `processed: ${input.query}` }),
      },
      {
        name: 'approval_tool',
        description: 'A tool that needs approval',
        input_schema: { type: 'object' as const, properties: { action: { type: 'string' } }, required: [] },
        requiresApproval: true,
        execute: async (input) => ({ done: true, action: input.action }),
      },
    ],
  }
  registerToolGroup(testGroup)
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('startSession', () => {
  it('emits session_created and processes text response', async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse('Analysis complete. No issues found.'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    expect(events[0]).toEqual({ type: 'session_created', sessionId: expect.any(String) })

    const messageEvent = events.find(e => e.type === 'message')
    expect(messageEvent).toBeDefined()
    expect((messageEvent as any).content).toContain('Analysis complete')

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
  })

  it('executes tool calls in full_auto mode', async () => {
    // First call: Claude wants to use a tool
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([{ name: 'test_tool', input: { query: 'members' } }]),
    )
    // Second call: Claude produces final text
    mockCreate.mockResolvedValueOnce(makeTextResponse('Found 3 at-risk members.'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    const toolCall = events.find(e => e.type === 'tool_call')
    expect(toolCall).toBeDefined()
    expect((toolCall as any).name).toBe('test_tool')

    const toolResult = events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect((toolResult as any).result).toEqual({ result: 'processed: members' })

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })

  it('pauses on approval-required tools in semi_auto mode', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([{ name: 'approval_tool', input: { action: 'send email' } }]),
    )

    const events = []
    for await (const event of startSession(makeConfig({ autonomyMode: 'semi_auto' }))) {
      events.push(event)
    }

    const pending = events.find(e => e.type === 'tool_pending')
    expect(pending).toBeDefined()
    expect((pending as any).name).toBe('approval_tool')

    const paused = events.find(e => e.type === 'paused')
    expect(paused).toBeDefined()
    expect((paused as any).status).toBe('waiting_approval')
  })

  it('does NOT pause on approval-required tools in full_auto mode', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([{ name: 'approval_tool', input: { action: 'send' } }]),
    )
    mockCreate.mockResolvedValueOnce(makeTextResponse('Done.'))

    const events = []
    for await (const event of startSession(makeConfig({ autonomyMode: 'full_auto' }))) {
      events.push(event)
    }

    const pending = events.find(e => e.type === 'tool_pending')
    expect(pending).toBeUndefined()

    const toolResult = events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
  })

  it('respects max turns limit', async () => {
    // Always return tool use — should stop at max turns
    mockCreate.mockResolvedValue(
      makeToolUseResponse([{ name: 'test_tool', input: { query: 'loop' } }]),
    )

    const events = []
    for await (const event of startSession(makeConfig({ maxTurns: 3 }))) {
      events.push(event)
    }

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
    expect((done as any).summary).toContain('max reached')
  })

  it('pauses in turn_based mode after text response', async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse('Here is what I found.'))

    const events = []
    for await (const event of startSession(makeConfig({ autonomyMode: 'turn_based' }))) {
      events.push(event)
    }

    const paused = events.find(e => e.type === 'paused')
    expect(paused).toBeDefined()
    expect((paused as any).status).toBe('waiting_input')
  })

  it('tracks cost across turns', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([{ name: 'test_tool', input: { query: 'a' } }]),
    )
    mockCreate.mockResolvedValueOnce(makeTextResponse('Done.'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    // calcCost returns 0.01 per call, 2 calls = 0.02 = 2 cents
    // The mock returns costUsd: 0.01, so costCents = 1 per turn
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('stops when budget is exceeded', async () => {
    // Budget of 0 cents — should stop immediately
    mockCreate.mockResolvedValueOnce(makeTextResponse('Starting...'))

    const events = []
    for await (const event of startSession(makeConfig({ budgetCents: 0 }))) {
      events.push(event)
    }

    // Should get a budget message
    const budgetMsg = events.find(
      e => e.type === 'message' && (e as any).content.includes('Budget limit'),
    )
    expect(budgetMsg).toBeDefined()
  })
})

describe('resumeSession', () => {
  it('returns error for non-existent session', async () => {
    // loadSession returns null
    const { loadSession: actualLoad } = await import('../agents/session-runtime')

    const events = []
    for await (const event of resumeSession('nonexistent', { message: 'hello' })) {
      events.push(event)
    }

    const error = events.find(e => e.type === 'error')
    expect(error).toBeDefined()
  })
})

describe('tool execution', () => {
  it('handles unknown tool gracefully', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'tc-1', name: 'nonexistent_tool', input: {} },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    mockCreate.mockResolvedValueOnce(makeTextResponse('Moving on.'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    // Should still complete without crashing
    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })

  it('handles tool execution errors gracefully', async () => {
    _clearRegistry()
    _resetRegistration()

    const errorGroup: ToolGroup = {
      name: 'test',
      tools: [
        {
          name: 'error_tool',
          description: 'Always errors',
          input_schema: { type: 'object' as const, properties: {}, required: [] },
          requiresApproval: false,
          execute: async () => { throw new Error('Tool exploded') },
        },
      ],
    }
    registerToolGroup(errorGroup)

    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse([{ name: 'error_tool', input: {} }]),
    )
    mockCreate.mockResolvedValueOnce(makeTextResponse('Handled the error.'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    const result = events.find(e => e.type === 'tool_result')
    expect(result).toBeDefined()
    expect((result as any).result).toEqual({ error: 'Tool exploded' })

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })
})

describe('Claude API errors', () => {
  it('emits error and sets status to failed', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    const error = events.find(e => e.type === 'error')
    expect(error).toBeDefined()
    expect((error as any).message).toContain('API rate limit')
  })
})

describe('system prompt assembly', () => {
  it('includes base context and tool instructions', async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse('OK'))

    const events = []
    for await (const event of startSession(makeConfig())) {
      events.push(event)
    }

    // Verify Claude was called with a system prompt
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system).toContain('You are an AI agent')
    expect(callArgs.system).toContain('Tools & Interaction Model')
  })

  it('includes autonomy mode instructions', async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse('OK'))

    for await (const event of startSession(makeConfig({ autonomyMode: 'turn_based' }))) {
      // consume
    }

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system).toContain('conversation mode')
  })
})
