/**
 * generate-instructions.test.ts
 *
 * Tests the AI custom instruction generation endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockSessionRef, mockAnthropicCreateRef } = vi.hoisted(() => ({
  mockSessionRef: { current: null as any },
  mockAnthropicCreateRef: { current: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getSession: () => mockSessionRef.current,
}))

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = { create: (...args: any[]) => mockAnthropicCreateRef.current(...args) }
    },
  }
})

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('# Skill file content\nSome playbook rules'),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: Record<string, any>) {
  return new NextRequest('http://localhost:3000/api/setup/generate-instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BASE_BODY = {
  agentType: 'lead_reactivation',
  agentName: 'Lead Re-Activation',
  accountName: 'Peak Fitness',
  stats: [
    { label: 'Ghost Leads', value: 42, emphasis: true },
    { label: 'Avg Age', value: '120d' },
  ],
  description: 'Re-engage old leads who went cold.',
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/setup/generate-instructions', () => {
  const MOCK_PROMPT = `You are a Lead Re-Activation Specialist representing Peak Fitness. Your mission is to professionally reconnect with 42 dormant prospects on behalf of the owner.

Capabilities:
- Craft personalized re-engagement messages that acknowledge the passage of time
- Reference previous interactions or expressed interests when available

Guidelines:
- Always write from the owner's perspective using first-person voice
- Keep messages concise and scannable

Boundaries:
- Do not make promises about products/services without explicit information
- Avoid aggressive sales language or urgency tactics

Your goal is to warmly reopen dialogue and remind leads why they were initially interested in Peak Fitness.`

  beforeEach(() => {
    mockSessionRef.current = { id: 'user-1' }
    mockAnthropicCreateRef.current = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: MOCK_PROMPT }],
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockSessionRef.current = null
    const { POST } = await import('@/app/api/setup/generate-instructions/route')
    const res = await POST(makeReq(BASE_BODY))
    expect(res.status).toBe(401)
  })

  it('returns a structured agent prompt', async () => {
    const { POST } = await import('@/app/api/setup/generate-instructions/route')
    const res = await POST(makeReq(BASE_BODY))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.instructions).toContain('Peak Fitness')
    expect(body.instructions).toContain('Capabilities:')
    expect(body.instructions).toContain('Guidelines:')
    expect(body.instructions).toContain('Boundaries:')
  })

  it('passes gym data and agent info to the meta-prompt', async () => {
    const { POST } = await import('@/app/api/setup/generate-instructions/route')
    await POST(makeReq(BASE_BODY))

    const call = mockAnthropicCreateRef.current.mock.calls[0][0]
    const prompt = call.messages[0].content
    expect(prompt).toContain('Peak Fitness')
    expect(prompt).toContain('Lead Re-Activation')
    expect(call.max_tokens).toBeGreaterThanOrEqual(600)
  })

  it('includes skill file context in the meta-prompt', async () => {
    const { POST } = await import('@/app/api/setup/generate-instructions/route')
    await POST(makeReq(BASE_BODY))

    const call = mockAnthropicCreateRef.current.mock.calls[0][0]
    const prompt = call.messages[0].content
    expect(prompt).toContain('playbook')
    expect(prompt).toContain('Skill file content')
  })

  it('handles AI failure gracefully with fallback instructions', async () => {
    mockAnthropicCreateRef.current = vi.fn().mockRejectedValue(new Error('API down'))
    const { POST } = await import('@/app/api/setup/generate-instructions/route')
    const res = await POST(makeReq(BASE_BODY))
    // Returns 200 with fallback instructions instead of 500
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.instructions).toBeDefined()
    expect(body.instructions).toContain('Lead Re-Activation')
  })
})
