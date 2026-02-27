import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatScheduleForMemory, writeScheduleFromSnapshot, type ScheduleData } from '../sync-schedule'

// ── Mock Supabase ────────────────────────────────────────────────────────────

const mockInsert = vi.fn()
const mockUpdate = vi.fn()

// Chainable query mock — returns { data: [], error: null } at any terminal point
function chainable(terminal: any = { data: [], error: null }): any {
  const proxy: any = new Proxy(() => proxy, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined
      if (prop === 'data') return terminal.data
      if (prop === 'error') return terminal.error
      return (..._args: any[]) => proxy
    },
    apply: (_target, _thisArg, _args) => proxy,
  })
  proxy.data = terminal.data
  proxy.error = terminal.error
  return proxy
}

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => chainable({ data: [], error: null }),
      insert: (...args: any[]) => {
        mockInsert(...args)
        return {
          select: () => ({
            single: () => ({
              data: { id: 'sched-1', ...args[0] },
              error: null,
            }),
          }),
        }
      },
      update: (...args: any[]) => {
        mockUpdate(...args)
        return { eq: () => ({ error: null }) }
      },
    }),
  },
}))

// ── Test data ────────────────────────────────────────────────────────────────

const baseSchedule: ScheduleData = {
  classes: [
    { name: 'CrossFit', coach: 'Coach Mike', day: 'Monday', time: '6:00 AM - 7:00 AM', maxCapacity: 20, enrolledCount: 15 },
    { name: 'Open Gym', day: 'Tuesday', time: '5:00 PM - 7:00 PM' },
    { name: 'Barbell Club', coach: 'Coach Sarah', day: 'Wednesday', time: '7:00 AM', maxCapacity: 12 },
  ],
  classTypes: ['CrossFit', 'Open Gym', 'Barbell Club', 'Yoga'],
  totalCheckins30Days: 850,
  checkinsPerMemberPerWeek: 2.3,
  attendanceTrend: 'stable',
  sampleSize: 45,
  syncedAt: '2026-02-26T12:00:00.000Z',
}

// ── Tests: formatScheduleForMemory ──────────────────────────────────────────

describe('formatScheduleForMemory', () => {
  it('lists classes with details', () => {
    const result = formatScheduleForMemory(baseSchedule)
    expect(result).toContain('Classes:')
    expect(result).toContain('CrossFit | Monday | 6:00 AM - 7:00 AM | coach: Coach Mike | cap: 15/20')
    expect(result).toContain('Open Gym | Tuesday | 5:00 PM - 7:00 PM')
    expect(result).toContain('Barbell Club | Wednesday | 7:00 AM | coach: Coach Sarah | cap: ?/12')
  })

  it('lists program types', () => {
    const result = formatScheduleForMemory(baseSchedule)
    expect(result).toContain('Programs offered: CrossFit, Open Gym, Barbell Club, Yoga')
  })

  it('shows total checkins', () => {
    const result = formatScheduleForMemory(baseSchedule)
    expect(result).toContain('Checkins (last 30 days): ~850 total')
  })

  it('shows per-member attendance with trend', () => {
    const result = formatScheduleForMemory(baseSchedule)
    expect(result).toContain('Avg per member: 2.3 visits/week (trend: stable)')
  })

  it('shows active members with checkins', () => {
    const result = formatScheduleForMemory(baseSchedule)
    expect(result).toContain('Active members with checkins: 45')
  })

  it('includes sync date', () => {
    const result = formatScheduleForMemory(baseSchedule)
    expect(result).toContain('Last synced: Feb 26, 2026')
  })

  it('omits classes section when empty', () => {
    const result = formatScheduleForMemory({ ...baseSchedule, classes: [] })
    expect(result).not.toContain('Classes:')
  })

  it('omits programs when empty', () => {
    const result = formatScheduleForMemory({ ...baseSchedule, classTypes: [] })
    expect(result).not.toContain('Programs offered')
  })

  it('omits attendance when no checkins', () => {
    const result = formatScheduleForMemory({
      ...baseSchedule,
      totalCheckins30Days: 0,
      checkinsPerMemberPerWeek: null,
      sampleSize: 0,
    })
    expect(result).not.toContain('Checkins')
    expect(result).not.toContain('visits/week')
    expect(result).not.toContain('Active members with checkins')
  })

  it('shows declining trend', () => {
    const result = formatScheduleForMemory({ ...baseSchedule, attendanceTrend: 'declining' })
    expect(result).toContain('trend: declining')
  })

  it('shows improving trend', () => {
    const result = formatScheduleForMemory({ ...baseSchedule, attendanceTrend: 'improving' })
    expect(result).toContain('trend: improving')
  })
})

// ── Tests: writeScheduleFromSnapshot ────────────────────────────────────────

describe('writeScheduleFromSnapshot', () => {
  beforeEach(() => {
    mockInsert.mockClear()
    mockUpdate.mockClear()
  })

  it('creates schedule memory from snapshot attendance data', async () => {
    const snapshot = {
      members: [
        { status: 'active', recentCheckinsCount: 8, previousCheckinsCount: 6 },
        { status: 'active', recentCheckinsCount: 3, previousCheckinsCount: 4 },
        { status: 'cancelled', recentCheckinsCount: 0, previousCheckinsCount: 0 },
        { status: 'prospect', recentCheckinsCount: 0, previousCheckinsCount: 0 },
      ],
    }

    const memoryId = await writeScheduleFromSnapshot('acct-1', snapshot)
    expect(memoryId).toBe('sched-1')
    expect(mockInsert).toHaveBeenCalled()
    const inserted = mockInsert.mock.calls[0][0]
    expect(inserted.category).toBe('schedule_and_attendance')
    expect(inserted.source).toBe('system')
  })

  it('computes attendance trend from checkin data', async () => {
    const snapshot = {
      members: [
        { status: 'active', recentCheckinsCount: 4, previousCheckinsCount: 10 },
        { status: 'active', recentCheckinsCount: 3, previousCheckinsCount: 8 },
      ],
    }

    await writeScheduleFromSnapshot('acct-1', snapshot)
    const content = mockInsert.mock.calls[0][0].content
    expect(content).toContain('trend: declining')
  })

  it('extrapolates total checkins from sample', async () => {
    const snapshot = {
      members: [
        { status: 'active', recentCheckinsCount: 10, previousCheckinsCount: 8 },
        { status: 'active', recentCheckinsCount: 12, previousCheckinsCount: 10 },
      ],
    }

    await writeScheduleFromSnapshot('acct-1', snapshot)
    const content = mockInsert.mock.calls[0][0].content
    // 2 active members sampled, avg 11 checkins each, 2 active total → ~22
    expect(content).toContain('Checkins (last 30 days): ~22 total')
  })

  it('skips cancelled and prospect members for attendance', async () => {
    const snapshot = {
      members: [
        { status: 'active', recentCheckinsCount: 10, previousCheckinsCount: 8 },
        { status: 'cancelled', recentCheckinsCount: 5, previousCheckinsCount: 5 },
        { status: 'prospect', recentCheckinsCount: 0, previousCheckinsCount: 0 },
      ],
    }

    await writeScheduleFromSnapshot('acct-1', snapshot)
    const content = mockInsert.mock.calls[0][0].content
    // Only 1 active member with checkins
    expect(content).toContain('Checkins (last 30 days): ~10 total')
  })

  it('handles no attendance data gracefully', async () => {
    const snapshot = {
      members: [
        { status: 'active', recentCheckinsCount: 0, previousCheckinsCount: 0 },
      ],
    }

    await writeScheduleFromSnapshot('acct-1', snapshot)
    const content = mockInsert.mock.calls[0][0].content
    expect(content).not.toContain('Checkins')
    expect(content).not.toContain('visits/week')
    expect(content).toContain('Last synced')
  })
})
