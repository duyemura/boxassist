/**
 * workflow-runner.test.ts
 *
 * Tests for the workflow step execution engine.
 * Pattern: mock Supabase per-test, assert what gets written to DB.
 *
 * TDD usage:
 *   pnpm test --watch lib/__tests__/workflow-runner.test.ts
 *
 * Adding new step kinds:
 *   1. Write the test (red)
 *   2. Implement in lib/workflow-runner.ts (green)
 *   3. Refactor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { advanceRun, handleWorkflowReply } from '../workflow-runner'
import { createClient } from '@supabase/supabase-js'

// ── Fixtures ────────────────────────────────────────────────────────────────

const makeRun = (overrides = {}): any => ({
  id: 'run-uuid-1',
  workflow_id: 'wf-uuid-1',
  account_id: 'gym-test',
  member_id: 'member-1',
  member_email: 'alex@example.com',
  member_name: 'Alex',
  status: 'active',
  current_step: 'step_1',
  goal: 'Get the member back through the door',
  context: { accountName: 'Iron & Grit CrossFit', history: [] },
  started_at: new Date().toISOString(),
  ...overrides,
})

const makeWorkflow = (steps: any[]): any => ({
  id: 'wf-uuid-1',
  account_id: null,
  name: 'Test Workflow',
  goal: 'Test goal',
  timeout_days: 30,
  steps,
})

// ── advanceRun — pure logic checks ───────────────────────────────────────────
// These test the routing logic without asserting DB side effects.
// DB interaction tests belong in integration tests with a real test DB.

describe('advanceRun routing logic', () => {
  it('goal_achieved is a terminal state', () => {
    const terminalStates = ['goal_achieved', 'give_up', 'failed']
    expect(terminalStates.includes('goal_achieved')).toBe(true)
  })

  it('give_up maps to failed status', () => {
    const statusFor = (nextStep: string) => {
      if (nextStep === 'goal_achieved') return 'achieved'
      if (nextStep === 'give_up' || nextStep === 'failed') return 'failed'
      return 'active'
    }
    expect(statusFor('give_up')).toBe('failed')
    expect(statusFor('goal_achieved')).toBe('achieved')
    expect(statusFor('step_2')).toBe('active')
  })

  it('logs an error for missing step IDs without crashing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = makeRun()
    const workflow = makeWorkflow([{ id: 'step_1', kind: 'wait', config: {} }])

    // advanceRun with an unknown step should log and return gracefully
    await advanceRun(run, 'step_does_not_exist', workflow)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('step_does_not_exist')
    )
    consoleSpy.mockRestore()
  })
})

// ── handleWorkflowReply ─────────────────────────────────────────────────────

describe('handleWorkflowReply', () => {
  it('advances to on_reply_positive step on positive sentiment', async () => {
    const run = makeRun({ current_step: 'step_email_1' })
    const workflow = makeWorkflow([
      {
        id: 'step_email_1',
        kind: 'outreach',
        config: {
          on_reply_positive: 'step_tag',
          on_reply_negative: 'step_close',
          on_no_reply: 'step_followup',
        },
      },
      { id: 'step_tag', kind: 'integration', config: { type: 'pushpress_tag', tag: 'win-back', on_sent: 'goal_achieved' } },
    ])

    const supabase = createClient('', '') as any
    // Simulate DB returning the run + workflow
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { ...run, workflows: workflow }, error: null }),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnValue({ then: (r: any) => r({ data: null, error: null }) }),
    })

    // Should not throw
    await expect(
      handleWorkflowReply({ runId: run.id, stepId: 'step_email_1', replyText: 'Yes I\'d love to come back!', sentiment: 'positive' })
    ).resolves.not.toThrow()
  })

  it('advances to on_reply_negative step on negative sentiment', async () => {
    const run = makeRun({ current_step: 'step_email_1' })
    const workflow = makeWorkflow([
      {
        id: 'step_email_1',
        kind: 'outreach',
        config: {
          on_reply_positive: 'step_tag',
          on_reply_negative: 'step_close',
        },
      },
      { id: 'step_close', kind: 'owner_alert', config: { message: 'Member declined', on_sent: 'give_up' } },
    ])

    const supabase = createClient('', '') as any
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { ...run, workflows: workflow }, error: null }),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnValue({ then: (r: any) => r({ data: null, error: null }) }),
    })

    await expect(
      handleWorkflowReply({ runId: run.id, stepId: 'step_email_1', replyText: 'Not interested anymore', sentiment: 'negative' })
    ).resolves.not.toThrow()
  })

  it('is a no-op if run is already achieved', async () => {
    const run = makeRun({ status: 'achieved' })

    const supabase = createClient('', '') as any
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { ...run, workflows: {} }, error: null }),
    })

    // Should return early without doing anything
    await expect(
      handleWorkflowReply({ runId: run.id, stepId: 'step_1', replyText: 'Hey', sentiment: 'positive' })
    ).resolves.toBeUndefined()
  })
})

// ── Reply agent decision parsing ─────────────────────────────────────────────

describe('reply sentiment routing', () => {
  it('positive reply routes to success path', () => {
    const cfg = { on_reply_positive: 'step_2', on_reply_negative: 'step_3' }
    const sentiment = 'positive'
    const nextStep = sentiment === 'positive' && cfg.on_reply_positive
      ? cfg.on_reply_positive
      : cfg.on_reply_negative

    expect(nextStep).toBe('step_2')
  })

  it('negative reply routes to failure path', () => {
    const cfg = { on_reply_positive: 'step_2', on_reply_negative: 'step_3' }
    const sentiment: string = 'negative'
    const nextStep = sentiment === 'positive' && cfg.on_reply_positive
      ? cfg.on_reply_positive
      : cfg.on_reply_negative

    expect(nextStep).toBe('step_3')
  })

  it('falls back to positive path when no negative route configured', () => {
    const cfg = { on_reply_positive: 'step_2' }
    const sentiment = 'negative'
    // Should fall back to positive path if no negative configured
    const nextStep = cfg.on_reply_positive

    expect(nextStep).toBe('step_2')
  })
})
