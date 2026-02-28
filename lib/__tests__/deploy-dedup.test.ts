/**
 * deploy-dedup.test.ts
 *
 * Tests that the agent deploy route prevents duplicate agents.
 * When an agent with the same skill_type already exists for an account,
 * the deploy route should update the existing agent instead of creating a new one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockSessionRef,
  mockAccountRef,
  mockSingleRef,
  mockUpdateRef,
  mockInsertRef,
  mockUpsertRef,
} = vi.hoisted(() => ({
  mockSessionRef: { current: null as any },
  mockAccountRef: { current: null as any },
  mockSingleRef: { current: { data: null, error: null } as any },
  mockUpdateRef: { current: vi.fn() },
  mockInsertRef: { current: vi.fn() },
  mockUpsertRef: { current: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getSession: () => mockSessionRef.current,
}))

vi.mock('@/lib/db/accounts', () => ({
  getAccountForUser: () => mockAccountRef.current,
}))

// Chain-based Supabase mock
vi.mock('@/lib/supabase', () => {
  const chain = (terminal?: any) => {
    const proxy: any = new Proxy(() => terminal ?? { data: null, error: null }, {
      get: (_t, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'data') return terminal?.data ?? null
        if (prop === 'error') return terminal?.error ?? null
        if (prop === 'single') return () => mockSingleRef.current
        if (prop === 'select') return () => chain(terminal)
        if (prop === 'eq') return () => chain(terminal)
        if (prop === 'update') return (...args: any[]) => {
          mockUpdateRef.current(...args)
          return chain({ data: null, error: null })
        }
        if (prop === 'upsert') return (...args: any[]) => {
          mockUpsertRef.current(...args)
          return chain({ data: null, error: null })
        }
        if (prop === 'insert') return (...args: any[]) => {
          mockInsertRef.current(...args)
          return {
            select: () => ({
              single: () => ({ data: { id: 'new-agent-123' }, error: null }),
            }),
            then: (resolve: any) => resolve({ data: null, error: null }),
          }
        }
        return () => chain(terminal)
      },
    })
    return proxy
  }

  return {
    supabaseAdmin: {
      from: () => chain(),
    },
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(config: Record<string, any>) {
  return new NextRequest('http://localhost:3000/api/agent-builder/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  })
}

const BASE_CONFIG = {
  name: 'Lead Re-Activation',
  description: 'Re-engage old leads',
  skill_type: 'lead_reactivation',
  system_prompt: 'You are a lead agent',
  trigger_mode: 'cron',
  trigger_event: null,
  cron_schedule: 'daily',
  run_hour: 9,
  action_type: 'draft_message',
  data_sources: [],
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/agent-builder/deploy — dedup', () => {
  beforeEach(() => {
    mockSessionRef.current = { id: 'user-1' }
    mockAccountRef.current = { id: 'acct-1' }
    mockSingleRef.current = { data: null, error: { code: 'PGRST116' } } // no existing agent
    mockUpdateRef.current = vi.fn()
    mockInsertRef.current = vi.fn()
    mockUpsertRef.current = vi.fn()
  })

  it('returns 401 when not authenticated', async () => {
    mockSessionRef.current = null
    const { POST } = await import('@/app/api/agent-builder/deploy/route')
    const res = await POST(makeReq(BASE_CONFIG))
    expect(res.status).toBe(401)
  })

  it('creates a new agent when no duplicate exists', async () => {
    mockSingleRef.current = { data: null, error: { code: 'PGRST116' } }
    const { POST } = await import('@/app/api/agent-builder/deploy/route')
    const res = await POST(makeReq(BASE_CONFIG))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.agent_id).toBe('new-agent-123')
    expect(body.updated).toBeUndefined()
    expect(mockInsertRef.current).toHaveBeenCalled()
  })

  it('updates existing agent instead of creating duplicate', async () => {
    // Simulate existing agent with same skill_type
    mockSingleRef.current = { data: { id: 'existing-agent-1', name: 'Lead Re-Activation' }, error: null }

    const { POST } = await import('@/app/api/agent-builder/deploy/route')
    const res = await POST(makeReq({ ...BASE_CONFIG, system_prompt: 'Updated prompt' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.agent_id).toBe('existing-agent-1')
    expect(body.updated).toBe(true)
    // Should have called update, not insert
    expect(mockUpdateRef.current).toHaveBeenCalled()
  })

  it('returns the existing agent id when updating', async () => {
    mockSingleRef.current = { data: { id: 'keep-this-id', name: 'Old Name' }, error: null }

    const { POST } = await import('@/app/api/agent-builder/deploy/route')
    const res = await POST(makeReq(BASE_CONFIG))
    const body = await res.json()

    expect(body.agent_id).toBe('keep-this-id')
    expect(body.name).toBe('Lead Re-Activation')
  })
})
