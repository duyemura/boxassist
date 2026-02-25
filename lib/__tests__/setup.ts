/**
 * Global test setup — mock all external services so tests never hit real APIs.
 * Pattern: vi.mock at module level, override per-test with mockResolvedValueOnce.
 */
import { vi } from 'vitest'

// ── Supabase ────────────────────────────────────────────────────────────────
// The default mock returns empty success for all queries.
// Override per-test: supabaseMock.from.mockReturnValueOnce(...)
vi.mock('@supabase/supabase-js', () => {
  const chain = () => {
    const obj: any = {}
    const methods = ['select','insert','update','delete','upsert','eq','neq','is','or','not','in','gte','lt','lte','single','limit','order','filter']
    methods.forEach(m => { obj[m] = vi.fn().mockReturnValue(obj) })
    obj.then = (resolve: any) => resolve({ data: null, error: null })
    return obj
  }
  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => chain()),
    })),
  }
})

// ── Anthropic ───────────────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"decision":"close","reply":"See you soon!","reason":"Member confirmed return"}' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  })
  class MockAnthropic {
    messages = { create: mockCreate }
    constructor(_opts?: any) {}
  }
  return { default: MockAnthropic }
})

// ── Resend / email ──────────────────────────────────────────────────────────
vi.mock('../resend', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'email-test-123', error: null }),
}))

// ── Environment vars ────────────────────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
process.env.CRON_SECRET = 'test-cron-secret'
