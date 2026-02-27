/**
 * sync-schedule.ts
 *
 * Fetches class schedule + attendance data from PushPress and writes them
 * as a `schedule_and_attendance` memory. Separate from business_stats so
 * the AI has a clean view of what classes exist, when they run, who coaches
 * them, and how attendance is trending.
 *
 * Call from: setup/recommend, manual refresh, or analysis cron.
 */

import { ppGet } from './pushpress-platform'
import type { PPClass, PPClassType, PPCheckin } from './pushpress-platform'
import {
  getAccountMemories,
  updateMemory,
  createMemory,
} from './db/memories'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClassInfo {
  name: string
  coach?: string
  day?: string               // e.g. 'Monday' or 'Mon/Wed/Fri'
  time?: string              // e.g. '6:00 AM' or '6:00 AM - 7:00 AM'
  maxCapacity?: number
  enrolledCount?: number
}

export interface ScheduleData {
  classes: ClassInfo[]
  classTypes: string[]           // unique program/class type names
  totalCheckins30Days: number
  checkinsPerMemberPerWeek: number | null
  attendanceTrend: 'improving' | 'stable' | 'declining' | 'unknown'
  sampleSize: number
  syncedAt: string
}

export interface ScheduleSyncResult {
  schedule: ScheduleData
  memoryId: string
}

// ── Core sync function ────────────────────────────────────────────────────────

/**
 * Fetch class schedule + attendance from PushPress Platform API and write
 * the schedule_and_attendance memory.
 */
export async function syncSchedule(
  accountId: string,
  apiKey: string,
  companyId: string,
  activeMembers: number,
): Promise<ScheduleSyncResult> {
  const now = new Date()
  const thirtyDaysAgoSec = Math.floor((now.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000)
  const sixtyDaysAgoSec = Math.floor((now.getTime() - 60 * 24 * 60 * 60 * 1000) / 1000)
  const nowSec = Math.floor(now.getTime() / 1000)

  // Fetch classes, class types, and checkins in parallel
  const [rawClasses, rawClassTypes, recentCheckins, previousCheckins] = await Promise.all([
    ppGet<PPClass>(apiKey, '/classes', {}, companyId).catch(() => [] as PPClass[]),
    ppGet<PPClassType>(apiKey, '/classes/types', {}, companyId).catch(() => [] as PPClassType[]),
    ppGet<PPCheckin>(apiKey, '/checkins', {
      startTimestamp: String(thirtyDaysAgoSec),
      endTimestamp: String(nowSec),
    }, companyId).catch(() => [] as PPCheckin[]),
    ppGet<PPCheckin>(apiKey, '/checkins', {
      startTimestamp: String(sixtyDaysAgoSec),
      endTimestamp: String(thirtyDaysAgoSec),
    }, companyId).catch(() => [] as PPCheckin[]),
  ])

  console.log('[sync-schedule] Fetched', rawClasses.length, 'classes,', rawClassTypes.length, 'class types,', recentCheckins.length, 'recent checkins')

  // Log sample data to help debug field names
  if (rawClasses.length > 0) {
    console.log('[sync-schedule] Sample class keys:', Object.keys(rawClasses[0]).join(', '))
  }
  if (rawClassTypes.length > 0) {
    console.log('[sync-schedule] Sample classType keys:', Object.keys(rawClassTypes[0]).join(', '))
  }

  // Build class type name index
  const classTypeNames = new Map<string, string>()
  for (const ct of rawClassTypes) {
    classTypeNames.set(ct.id, ct.name)
  }

  // Map classes into ClassInfo
  const classes: ClassInfo[] = rawClasses
    .filter(c => c.status !== 'cancelled')
    .map(c => ({
      name: c.name || classTypeNames.get(c.typeId || '') || 'Class',
      coach: c.staffName || c.coach || undefined,
      day: formatDay(c),
      time: formatTime(c),
      maxCapacity: c.maxCapacity || c.defaultCapacity || undefined,
      enrolledCount: c.enrolledCount || undefined,
    }))

  // Deduplicate: group by name+day+time, keep the one with most info
  const deduped = deduplicateClasses(classes)

  // Unique class type names
  const classTypes = Array.from(new Set(rawClassTypes.map(ct => ct.name).filter(Boolean)))

  // Attendance — count only attendee checkins with successful result
  const attendeeCheckins = recentCheckins.filter(c =>
    (c.role === 'attendee' || !c.role) && (c.result === 'success' || !c.result)
  )
  const previousAttendeeCheckins = previousCheckins.filter(c =>
    (c.role === 'attendee' || !c.role) && (c.result === 'success' || !c.result)
  )

  // Count unique members who checked in
  const uniqueMembers = new Set(attendeeCheckins.map(c => c.customer))
  const sampleSize = uniqueMembers.size

  const totalCheckins30Days = attendeeCheckins.length

  // Per-member per-week (30 days ≈ 4.3 weeks)
  const checkinsPerMemberPerWeek = sampleSize > 0
    ? Math.round((totalCheckins30Days / sampleSize / 4.3) * 10) / 10
    : null

  // Trend: compare this 30d vs previous 30d
  let attendanceTrend: ScheduleData['attendanceTrend'] = 'unknown'
  if (totalCheckins30Days > 0 && previousAttendeeCheckins.length > 0) {
    const ratio = totalCheckins30Days / previousAttendeeCheckins.length
    if (ratio > 1.15) attendanceTrend = 'improving'
    else if (ratio < 0.85) attendanceTrend = 'declining'
    else attendanceTrend = 'stable'
  }

  const schedule: ScheduleData = {
    classes: deduped,
    classTypes,
    totalCheckins30Days,
    checkinsPerMemberPerWeek,
    attendanceTrend,
    sampleSize,
    syncedAt: now.toISOString(),
  }

  const memoryId = await writeScheduleMemory(accountId, schedule)
  return { schedule, memoryId }
}

// ── Build schedule from snapshot (avoids double-fetching) ────────────────────

/**
 * Write schedule memory from data already available in a snapshot.
 * Used during setup when we've already fetched checkin data per member.
 */
export async function writeScheduleFromSnapshot(
  accountId: string,
  snapshot: {
    members: Array<{
      status: string
      recentCheckinsCount: number
      previousCheckinsCount: number
    }>
  },
): Promise<string> {
  const now = new Date()

  let totalRecent = 0, totalPrevious = 0, sampledCount = 0
  let activeCount = 0

  for (const m of snapshot.members) {
    if (m.status === 'prospect' || m.status === 'cancelled') continue
    if (m.status !== 'paused') activeCount++

    if (m.recentCheckinsCount > 0 || m.previousCheckinsCount > 0) {
      totalRecent += m.recentCheckinsCount
      totalPrevious += m.previousCheckinsCount
      sampledCount++
    }
  }

  const checkinsPerMemberPerWeek = sampledCount > 0
    ? Math.round((totalRecent / sampledCount / 4.3) * 10) / 10
    : null

  let attendanceTrend: ScheduleData['attendanceTrend'] = 'unknown'
  if (sampledCount > 0 && totalPrevious > 0) {
    const ratio = totalRecent / totalPrevious
    if (ratio > 1.15) attendanceTrend = 'improving'
    else if (ratio < 0.85) attendanceTrend = 'declining'
    else attendanceTrend = 'stable'
  }

  const totalCheckins30Days = sampledCount > 0 && activeCount > 0
    ? Math.round((totalRecent / sampledCount) * activeCount)
    : 0

  const schedule: ScheduleData = {
    classes: [],       // not available from snapshot — will fill on next full sync
    classTypes: [],
    totalCheckins30Days,
    checkinsPerMemberPerWeek,
    attendanceTrend,
    sampleSize: sampledCount,
    syncedAt: now.toISOString(),
  }

  return writeScheduleMemory(accountId, schedule)
}

// ── Format schedule as memory string ────────────────────────────────────────

export function formatScheduleForMemory(schedule: ScheduleData): string {
  const lines: string[] = []

  // Class schedule
  if (schedule.classes.length > 0) {
    lines.push('Classes:')
    for (const c of schedule.classes) {
      const parts = [c.name]
      if (c.day) parts.push(c.day)
      if (c.time) parts.push(c.time)
      if (c.coach) parts.push(`coach: ${c.coach}`)
      if (c.maxCapacity) {
        const enrolled = c.enrolledCount ?? '?'
        parts.push(`cap: ${enrolled}/${c.maxCapacity}`)
      }
      lines.push(`  - ${parts.join(' | ')}`)
    }
  }

  // Class types / programs
  if (schedule.classTypes.length > 0) {
    lines.push(`Programs offered: ${schedule.classTypes.join(', ')}`)
  }

  // Attendance
  if (schedule.totalCheckins30Days > 0) {
    lines.push(`Checkins (last 30 days): ~${schedule.totalCheckins30Days} total`)
  }
  if (schedule.checkinsPerMemberPerWeek !== null) {
    lines.push(`Avg per member: ${schedule.checkinsPerMemberPerWeek} visits/week (trend: ${schedule.attendanceTrend})`)
  }
  if (schedule.sampleSize > 0 && schedule.totalCheckins30Days > 0) {
    lines.push(`Active members with checkins: ${schedule.sampleSize}`)
  }

  // Sync time
  const syncDate = new Date(schedule.syncedAt)
  lines.push(`Last synced: ${syncDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)

  return lines.join('\n')
}

// ── Write/update the schedule_and_attendance memory ─────────────────────────

async function writeScheduleMemory(accountId: string, schedule: ScheduleData): Promise<string> {
  const content = formatScheduleForMemory(schedule)

  const existing = await getAccountMemories(accountId, { category: 'schedule_and_attendance' })
  const schedMemory = existing.find(m => m.source === 'system')

  if (schedMemory) {
    await updateMemory(schedMemory.id, { content })
    return schedMemory.id
  }

  const created = await createMemory({
    accountId,
    category: 'schedule_and_attendance',
    content,
    importance: 5,
    scope: 'global',
    source: 'system',
  })
  return created.id
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDay(c: PPClass): string | undefined {
  if (c.day) {
    return c.day.charAt(0).toUpperCase() + c.day.slice(1).toLowerCase()
  }
  if (c.dayOfWeek !== undefined) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return days[c.dayOfWeek] || undefined
  }
  if (c.date) {
    try {
      const d = new Date(c.date)
      return d.toLocaleDateString('en-US', { weekday: 'long' })
    } catch { return undefined }
  }
  return undefined
}

function formatTime(c: PPClass): string | undefined {
  if (!c.startTime) return undefined

  const start = formatTimeString(c.startTime)
  if (!start) return undefined

  if (c.endTime) {
    const end = formatTimeString(c.endTime)
    if (end) return `${start} - ${end}`
  }
  return start
}

function formatTimeString(raw: string): string | undefined {
  // Handle HH:mm format
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (match) {
    const h = parseInt(match[1])
    const m = match[2]
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m} ${ampm}`
  }

  // Handle ISO datetime
  try {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
  } catch { /* fall through */ }

  return undefined
}

/** Deduplicate classes by name+day+time, keeping the most info-rich entry */
function deduplicateClasses(classes: ClassInfo[]): ClassInfo[] {
  const map = new Map<string, ClassInfo>()
  for (const c of classes) {
    const key = `${c.name}|${c.day || ''}|${c.time || ''}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, c)
    } else {
      // Keep the one with more info (coach, capacity)
      if (!existing.coach && c.coach) map.set(key, { ...existing, coach: c.coach })
      if (!existing.maxCapacity && c.maxCapacity) map.set(key, { ...existing, maxCapacity: c.maxCapacity })
    }
  }
  return Array.from(map.values())
}

// Re-export PPClass and PPClassType extensions for potential use elsewhere
// (the actual types live in pushpress-platform.ts)
