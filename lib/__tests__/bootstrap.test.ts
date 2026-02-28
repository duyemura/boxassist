/**
 * bootstrap.test.ts
 *
 * Unit tests for bootstrapBusinessProfile:
 *   - Calls Claude with account name + member count
 *   - Writes a business profile memory
 *   - Updates accounts with type tag + bootstrapped flag
 *   - Skips if already bootstrapped (unless force=true)
 *   - Gracefully handles bad Claude responses
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFrom = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (...args: any[]) => mockFrom(...args) },
}))

vi.mock('@/lib/db/memories', () => ({
  createMemory: vi.fn().mockResolvedValue({ id: 'mem-1' }),
}))

import { bootstrapBusinessProfile } from '../agents/bootstrap'
import { createMemory } from '../db/memories'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(resolved: { data: any; error: any }) {
  const chain: any = {}
  const methods = ['select', 'update', 'insert', 'eq', 'single', 'maybeSingle', 'limit']
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single.mockResolvedValue(resolved)
  chain.then = (fn: any) => Promise.resolve(resolved).then(fn)
  return chain
}

const ACCOUNT_ID = 'acct-123'
const ACCOUNT_NAME = 'CrossFit Invictus'
const MEMBER_COUNT = 80

const validClaudeResponse = JSON.stringify({
  business_type_tag: 'crossfit_gym',
  profile: 'CrossFit gym with ~80 active members. High-intensity competitive community — members train 4x/week and respond to direct coach-voice. Absence of 10+ days warrants outreach. Sign off as "Coach [Name]".',
})

let mockClaude: { evaluate: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.clearAllMocks()
  mockClaude = { evaluate: vi.fn().mockResolvedValue(validClaudeResponse) }
  // Default: not yet bootstrapped
  mockFrom.mockReturnValue(makeChain({ data: { business_profile_bootstrapped: false }, error: null }))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bootstrapBusinessProfile', () => {
  it('calls Claude with account name and member count', async () => {
    await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
    )

    expect(mockClaude.evaluate).toHaveBeenCalledOnce()
    const [, prompt] = mockClaude.evaluate.mock.calls[0]
    expect(prompt).toContain(ACCOUNT_NAME)
    expect(prompt).toContain(String(MEMBER_COUNT))
  })

  it('writes a gym_context memory with importance 5', async () => {
    await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
    )

    expect(createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        category: 'gym_context',
        content: expect.stringContaining('CrossFit'),
        importance: 5,
        source: 'agent',
      }),
    )
  })

  it('updates accounts with business_type_tag and bootstrapped=true', async () => {
    const chain = makeChain({ data: { business_profile_bootstrapped: false }, error: null })
    mockFrom.mockReturnValue(chain)

    await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
    )

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        business_type_tag: 'crossfit_gym',
        business_profile_bootstrapped: true,
      }),
    )
    expect(chain.eq).toHaveBeenCalledWith('id', ACCOUNT_ID)
  })

  it('returns profile and skipped=false on success', async () => {
    const result = await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
    )

    expect(result.skipped).toBe(false)
    expect(result.profile.businessTypeTag).toBe('crossfit_gym')
    expect(result.profile.profile).toContain('CrossFit')
  })

  it('skips Claude and DB writes if already bootstrapped', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { business_profile_bootstrapped: true }, error: null }))

    const result = await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
    )

    expect(result.skipped).toBe(true)
    expect(mockClaude.evaluate).not.toHaveBeenCalled()
    expect(createMemory).not.toHaveBeenCalled()
  })

  it('runs even if bootstrapped when force=true', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { business_profile_bootstrapped: true }, error: null }))

    const result = await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
      { force: true },
    )

    expect(result.skipped).toBe(false)
    expect(mockClaude.evaluate).toHaveBeenCalledOnce()
    expect(createMemory).toHaveBeenCalledOnce()
  })

  it('throws if Claude returns no JSON', async () => {
    mockClaude.evaluate.mockResolvedValue('Unable to help with that.')

    await expect(
      bootstrapBusinessProfile(
        { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
        { claude: mockClaude as any },
      ),
    ).rejects.toThrow('[bootstrap] No JSON in Claude response')
  })

  it('uses fallback values when Claude response is missing fields', async () => {
    mockClaude.evaluate.mockResolvedValue('{}')

    const result = await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: 'Peaceful Pines Yoga', memberCount: 30 },
      { claude: mockClaude as any },
    )

    expect(result.profile.businessTypeTag).toBe('fitness_business')
    expect(result.profile.profile).toContain('Peaceful Pines Yoga')
  })

  it('does not throw if accounts check returns null data (new account path)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }))

    const result = await bootstrapBusinessProfile(
      { accountId: ACCOUNT_ID, accountName: ACCOUNT_NAME, memberCount: MEMBER_COUNT },
      { claude: mockClaude as any },
    )

    expect(result.skipped).toBe(false)
    expect(mockClaude.evaluate).toHaveBeenCalled()
  })
})
