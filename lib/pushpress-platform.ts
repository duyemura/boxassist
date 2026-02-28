/**
 * pushpress-platform.ts
 *
 * PushPress Platform API v1 client — typed against the real OpenAPI spec.
 *
 * Key differences from the old v3 SDK:
 *   - Base URL: https://api.pushpress.com/platform/v1 (configurable via PUSHPRESS_PLATFORM_URL env)
 *   - Auth: API-KEY header (not Authorization: Bearer)
 *   - Customer.name is { first, last, nickname } — nested object
 *   - Checkin.customer is the UUID (not customerId)
 *   - Checkin.timestamp is unix ms
 *   - Enrollment.status enum: active|alert|canceled|completed|paused|pendactivation|pendcancel
 *   - Enrollment.billingSchedule has { period, interval } — no amount field
 *   - Monthly revenue must be supplied separately (from Plan or known price)
 */

import type { MemberData, AccountSnapshot, PaymentEvent } from './agents/GMAgent'

// ── Constants ─────────────────────────────────────────────────────────────────

export const PP_PLATFORM_BASE =
  process.env.PUSHPRESS_PLATFORM_URL || 'https://api.pushpress.com/platform/v1'

/** PushPress v3 API — has /customers endpoint that Platform v1 lacks */
const PP_V3_BASE = 'https://api.pushpress.com/v3'

// ── OpenAPI types (exact field names from spec) ────────────────────────────────

export interface PPCustomerName {
  first: string
  last: string
  nickname: string | null
}

export interface PPCustomerAddress {
  line1: string
  line2: string
  city: string
  country: string
  state: string
  zip: string
}

export interface PPMembershipDetails {
  initialMembershipStartDate: string | null
}

export type PPCustomerRole =
  | 'superuser' | 'admin' | 'coach' | 'frontdesk'
  | 'member' | 'non-member' | 'ex-member' | 'lead'

export interface PPCustomer {
  id: string
  companyId: string
  name: PPCustomerName
  gender: 'male' | 'female' | null
  dob: string | null
  address: PPCustomerAddress
  account: { type: 'linked'; primaryCustomerId: string } | { type: 'primary' }
  membershipDetails: PPMembershipDetails | null
  email: string
  phone?: string | null
  role?: PPCustomerRole | null
  assignedToStaffId?: string | null
  profileImage?: string | null
}

export type PPEnrollmentStatus =
  | 'active'
  | 'alert'          // payment issue — still enrolled
  | 'canceled'
  | 'completed'      // plan ran its full course
  | 'paused'
  | 'pendactivation' // signed up, not yet started
  | 'pendcancel'     // scheduled to cancel, still active

export interface PPBillingSchedule {
  period: 'day' | 'week' | 'month' | 'year' | 'once'
  interval: number   // number of periods between bills (e.g. 3 = quarterly)
}

export interface PPCheckinDetails {
  checkins: number   // checkins used in current period
  limit: number      // -1 = unlimited
}

export interface PPEnrollment {
  id: string
  customerId: string
  companyId: string
  planId?: string | null
  status: PPEnrollmentStatus
  billingSchedule: PPBillingSchedule
  checkinDetails: PPCheckinDetails
  entitlements: unknown[]
  startDate?: string | null
  endDate?: string | null
  lastCharge?: string | null
  nextCharge?: string | null
  paidUntil?: string | null
}

/** Union type for all checkin kinds */
export interface PPCheckin {
  id: string
  customer: string   // UUID — note: field is "customer", NOT "customerId"
  company: string
  timestamp: number  // unix ms
  enrollmentId?: string | null
  name?: string
  kind: 'class' | 'appointment' | 'event' | 'open'
  role?: 'staff' | 'coach' | 'assistant' | 'attendee'
  result?: 'success' | 'failure'
  failureReason?: string | null
  // class-specific
  typeId?: string
  classId?: string
  source?: string
  // appointment-specific
  appointmentId?: string
  staffId?: string
  // event-specific
  eventId?: string
}

// ── Class / schedule types ────────────────────────────────────────────────────

/** A scheduled class instance from GET /classes */
export interface PPClass {
  id: string
  companyId?: string
  typeId?: string            // links to PPClassType
  name?: string
  description?: string
  startTime?: string         // ISO datetime or HH:mm
  endTime?: string           // ISO datetime or HH:mm
  date?: string              // ISO date
  day?: string               // day of week (e.g. 'monday')
  dayOfWeek?: number         // 0-6
  maxCapacity?: number       // class cap
  defaultCapacity?: number   // fallback capacity
  enrolledCount?: number     // current signups
  waitlistCount?: number
  coach?: string             // coach name or ID
  coachId?: string
  staffId?: string           // alternative field for coach
  staffName?: string
  location?: string
  room?: string
  status?: string            // 'active' | 'cancelled' etc.
  recurring?: boolean
}

/** A class type / program template from GET /classes/types */
export interface PPClassType {
  id: string
  companyId?: string
  name: string
  description?: string
  color?: string
  defaultDuration?: number   // minutes
  defaultCapacity?: number
  category?: string
  status?: string
}

// ── Mapped output type ────────────────────────────────────────────────────────

/** Intermediate type from mapCustomer — raw customer fields before enrollment merge */
export interface MappedCustomer {
  id: string
  name: string
  email: string
  phone?: string | null
  memberSince: string
  customerRole: PPCustomerRole | null
}

/** MemberData + payment alert flag + raw customer role */
export interface MemberDataWithFlags extends MemberData {
  hasPaymentAlert: boolean
  customerRole: PPCustomerRole | null
}

// ── ppApiHeaders ──────────────────────────────────────────────────────────────

/**
 * Returns the correct HTTP headers for the PushPress Platform API.
 * Uses API-KEY header (NOT Authorization: Bearer).
 */
export function ppApiHeaders(
  apiKey: string,
  companyId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'API-KEY': apiKey,
    'Content-Type': 'application/json',
  }
  if (companyId) {
    headers['company-id'] = companyId
  }
  return headers
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * GET from the Platform API. Handles both array and { data: [] } response shapes.
 * Automatically follows cursor-based pagination until all pages are fetched.
 */
export async function ppGet<T>(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
  companyId?: string,
): Promise<T[]> {
  const MAX_PAGES = 50 // safety cap (~5,000 members at 100/page)
  const all: T[] = []
  let cursor: string | undefined
  let pages = 0

  do {
    const url = new URL(`${PP_PLATFORM_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetch(url.toString(), {
      headers: ppApiHeaders(apiKey, companyId),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`PushPress Platform API ${res.status} ${path}: ${text}`)
    }

    const body = await res.json()

    // API returns either [...] or { data: [...], cursor?: string }
    const items = (Array.isArray(body) ? body : (body.data ?? [])) as T[]
    all.push(...items)

    // Advance cursor — check common field names
    cursor = body.cursor ?? body.nextCursor ?? body.next_cursor ?? undefined

    // If the response was a plain array, no pagination to follow
    if (Array.isArray(body)) break

    pages++
  } while (cursor && pages < MAX_PAGES)

  return all
}

// ── mapCustomer ───────────────────────────────────────────────────────────────

/**
 * Map a PPCustomer → MappedCustomer.
 * Handles the nested name object and memberSince fallback.
 */
export function mapCustomer(customer: PPCustomer): MappedCustomer {
  const first = (customer.name.first ?? '').trim()
  const last = (customer.name.last ?? '').trim()
  const joined = [first, last].filter(Boolean).join(' ')

  // If PushPress has no real name (or only a placeholder like "Member (+3)"),
  // derive a readable identifier from the email local-part (before @, before +)
  const looksLikePlaceholder = !joined || /^member(\s|$)/i.test(joined)
  const emailLocal = customer.email
    ? customer.email.split('@')[0].replace(/\+.*$/, '').replace(/[._-]/g, ' ')
    : ''
  const displayName = looksLikePlaceholder
    ? (emailLocal || customer.email || customer.id)
    : joined

  const memberSince =
    customer.membershipDetails?.initialMembershipStartDate ??
    new Date().toISOString().split('T')[0]

  return {
    id: customer.id,
    name: displayName,
    email: customer.email,
    phone: customer.phone,
    memberSince,
    customerRole: customer.role ?? null,
  }
}

// ── mapEnrollmentStatus ───────────────────────────────────────────────────────

/**
 * Map a PushPress enrollment status to our MemberData status.
 *
 * Enrollment status semantics:
 *   active       → active (paying)
 *   alert        → active but has payment issue (flag separately)
 *   canceled     → cancelled
 *   completed    → cancelled (plan ran its course, e.g. session pack done)
 *   paused       → paused
 *   pendactivation → active (about to start, treat as active)
 *   pendcancel   → active (still paying until end of period)
 */
export function mapEnrollmentStatus(
  status: PPEnrollmentStatus | string | undefined,
): MemberData['status'] {
  switch (status) {
    case 'active':
    case 'alert':         // payment issue but still enrolled
    case 'pendactivation':
    case 'pendcancel':    // scheduled to cancel but still active
      return 'active'
    case 'canceled':
    case 'completed':
      return 'cancelled'
    case 'paused':
      return 'paused'
    default:
      return 'active'     // safe default
  }
}

/**
 * Map customer.role to MemberData.status when there's no enrollment.
 */
export function mapCustomerRoleToStatus(role: PPCustomerRole | null | undefined): MemberData['status'] {
  switch (role) {
    case 'member':
    case 'admin':
    case 'coach':
    case 'frontdesk':
    case 'superuser':
      return 'active'
    case 'ex-member':
    case 'non-member':
      return 'cancelled'
    case 'lead':
      return 'prospect'
    default:
      return 'active'
  }
}

// ── normalizeMonthlyRevenue ───────────────────────────────────────────────────

/**
 * Convert a billing schedule + face-value amount to normalized monthly revenue.
 *
 * The billingSchedule.interval multiplies the period:
 *   period=month, interval=3 → billed every 3 months → amount/3 per month
 *   period=year,  interval=2 → billed every 2 years  → amount/24 per month
 *
 * @param schedule - The enrollment's billingSchedule
 * @param amount   - The face value of the bill (from Plan or known price)
 */
export function normalizeMonthlyRevenue(
  schedule: PPBillingSchedule | undefined,
  amount: number,
): number {
  if (!schedule || !amount) return 0
  const { period, interval } = schedule
  const effectiveInterval = interval || 1

  switch (period) {
    case 'month':
      return amount / effectiveInterval
    case 'week':
      // weeks per month ≈ 4.33; divide by interval if billing every N weeks
      return (amount * 4.33) / effectiveInterval
    case 'year':
      return amount / (12 * effectiveInterval)
    case 'day':
      return (amount * 30) / effectiveInterval
    case 'once':
      // Non-recurring — no monthly revenue contribution
      return 0
    default:
      return amount / effectiveInterval
  }
}

// ── buildMemberData ───────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Build a MemberDataWithFlags from a customer, their enrollment, and their checkins.
 *
 * Checkin attendance rules (from spec):
 *   - Only kind='class' | 'event' | 'open' count as attendance
 *   - Only role='attendee' counts (exclude 'staff', 'coach', 'assistant')
 *   - Only result='success' counts
 *   - Timestamp is unix ms
 *
 * Windows:
 *   recent:   0–30 days ago  → recentCheckinsCount
 *   previous: 31–60 days ago → previousCheckinsCount
 *
 * @param customer   - PPCustomer from /customers
 * @param enrollment - PPEnrollment from /enrollments (null if none)
 * @param checkins   - ALL checkins for this customer (recent + previous window)
 * @param now        - Reference time (injected for testability)
 * @param monthlyRevenue - Pre-computed monthly revenue (from enrollment + plan price)
 */
export function buildMemberData(
  customer: PPCustomer,
  enrollment: PPEnrollment | null,
  checkins: PPCheckin[],
  now: Date,
  monthlyRevenue = 0,
): MemberDataWithFlags {
  const mapped = mapCustomer(customer)

  // Determine member status
  const hasPaymentAlert = enrollment?.status === 'alert'
  const status = enrollment
    ? mapEnrollmentStatus(enrollment.status)
    : mapCustomerRoleToStatus(customer.role)

  // Count valid attendance checkins
  const thirtyDaysAgoMs = now.getTime() - 30 * MS_PER_DAY
  const sixtyDaysAgoMs = now.getTime() - 60 * MS_PER_DAY

  let recentCheckinsCount = 0
  let previousCheckinsCount = 0
  let maxRecentTs: number | undefined

  for (const checkin of checkins) {
    // Only count attendee check-ins with successful result
    if (checkin.role !== 'attendee') continue
    if (checkin.result !== 'success') continue
    // appointment checkins have no role field — skip for attendance counting
    if (checkin.kind === 'appointment') continue

    const ts = checkin.timestamp

    if (ts >= thirtyDaysAgoMs) {
      recentCheckinsCount++
      if (maxRecentTs === undefined || ts > maxRecentTs) {
        maxRecentTs = ts
      }
    } else if (ts >= sixtyDaysAgoMs) {
      previousCheckinsCount++
    }
  }

  const lastCheckinAt = maxRecentTs !== undefined
    ? new Date(maxRecentTs).toISOString()
    : undefined

  return {
    id: mapped.id,
    name: mapped.name,
    email: mapped.email,
    phone: mapped.phone ?? undefined,
    status,
    membershipType: enrollment?.planId ?? 'unknown',
    memberSince: mapped.memberSince,
    lastCheckinAt,
    recentCheckinsCount,
    previousCheckinsCount,
    renewalDate: enrollment?.nextCharge ?? undefined,
    monthlyRevenue,
    customerRole: mapped.customerRole,
    hasPaymentAlert,
  }
}

// ── V3 customer fetch ─────────────────────────────────────────────────────────

/**
 * Map a v3 customer role/status to PPCustomerRole.
 * V3 has flat `role` and `status` fields; Platform v1 has typed `role`.
 */
export function mapV3RoleToPP(customer: any): PPCustomerRole {
  const role = customer.role || customer.customer_role || ''
  const status = customer.status || ''

  if (role === 'lead' || status === 'lead') return 'lead'
  if (role === 'ex-member' || status === 'cancelled' || status === 'canceled') return 'ex-member'
  if (role === 'non-member') return 'non-member'
  if (role === 'admin') return 'admin'
  if (role === 'coach') return 'coach'
  if (role === 'frontdesk') return 'frontdesk'
  if (role === 'superuser') return 'superuser'
  return 'member'
}

/**
 * Map a v3 customer object (flat fields) to the PPCustomer shape (nested name).
 */
export function mapV3ToPPCustomer(c: any): PPCustomer {
  return {
    id: c.id,
    companyId: c.companyId || c.company_id || '',
    name: {
      first: c.first_name || c.firstName || '',
      last: c.last_name || c.lastName || '',
      nickname: c.nickname || null,
    },
    gender: c.gender || null,
    dob: c.dob || c.date_of_birth || null,
    address: {
      line1: c.address?.line1 || c.address?.street || '',
      line2: c.address?.line2 || '',
      city: c.address?.city || '',
      country: c.address?.country || '',
      state: c.address?.state || '',
      zip: c.address?.zip || c.address?.postalCode || '',
    },
    account: { type: 'primary' },
    membershipDetails: {
      initialMembershipStartDate:
        c.memberSince || c.member_since || c.joinDate || c.join_date ||
        c.startDate || c.start_date || c.created_at || c.createdAt ||
        c.date_added || c.dateAdded || null,
    },
    email: c.email || '',
    phone: c.phone || c.phone_number || null,
    role: mapV3RoleToPP(c),
  }
}

/**
 * Fetch all customers from the PushPress v3 API (paginated).
 * Platform v1 doesn't have a /customers endpoint — v3 does.
 * Maps v3's flat customer shape to the PPCustomer type for downstream compat.
 */
export async function fetchCustomersV3(
  apiKey: string,
  companyId?: string,
): Promise<PPCustomer[]> {
  const MAX_PAGES = 5
  const all: PPCustomer[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const url = `${PP_V3_BASE}/customers?limit=100&page=${page}`
    const res = await fetch(url, {
      headers: ppApiHeaders(apiKey, companyId),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`PushPress v3 API ${res.status} /customers: ${text}`)
    }

    const body = await res.json()
    const batch: any[] =
      body?.data?.resultArray ??
      body?.data ??
      body?.resultArray ??
      (Array.isArray(body) ? body : [])

    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch.map(mapV3ToPPCustomer))
    if (batch.length < 100) break
    page++
  }

  return all
}

// ── buildAccountSnapshot ─────────────────────────────────────────────────────

/**
 * Fetch all PushPress data for an account and build an abstract AccountSnapshot.
 *
 * This is the PushPress connector's "build snapshot" function. All PushPress-
 * specific API calls, type mappings, and enrollment priority logic live here
 * in the connector layer — the cron route just calls this and gets back an
 * abstract AccountSnapshot that any analysis pipeline can consume.
 *
 * Data sources:
 *   GET /customers   → v3 API (Platform v1 doesn't have this endpoint)
 *   GET /checkins    → Platform v1 (60-day window)
 *   GET /enrollments → Platform v1
 */
export async function buildAccountSnapshot(
  accountId: string,
  accountName: string,
  apiKey: string,
  companyId?: string,
): Promise<AccountSnapshot> {
  const now = new Date()
  const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const sixtyDaysAgoMs  = now.getTime() - 60 * 24 * 60 * 60 * 1000

  // Fetch customers from v3 API (Platform v1 doesn't have /customers)
  // Fetch enrollments + checkins from Platform v1 (graceful fallback if unavailable)
  const sixtyDaysAgoSec = Math.floor(sixtyDaysAgoMs / 1000)
  const nowSec = Math.floor(now.getTime() / 1000)

  // Customers are essential — if this fails, the whole snapshot fails
  const customers = await fetchCustomersV3(apiKey, companyId)

  // Enrollments + checkins are enrichment — degrade gracefully if Platform v1 is unavailable
  let enrollments: PPEnrollment[] = []
  let checkins: PPCheckin[] = []

  try {
    ;[enrollments, checkins] = await Promise.all([
      ppGet<PPEnrollment>(apiKey, '/enrollments', {}, companyId),
      ppGet<PPCheckin>(apiKey, '/checkins', {
        startTimestamp: String(sixtyDaysAgoSec),
        endTimestamp: String(nowSec),
      }, companyId),
    ])
  } catch (err: any) {
    console.warn(`[buildAccountSnapshot] Platform v1 enrichment failed (non-fatal): ${err.message}`)
    // Continue with customers only — members will have status from role, no checkin/enrollment data
  }

  // Index: customerId → most recent active enrollment
  // PushPress enrollment status priority — prefer active enrollments over cancelled
  const enrollmentByCustomer = new Map<string, PPEnrollment>()
  const ENROLLMENT_PRIORITY: Record<string, number> = {
    active: 0, alert: 1, pendcancel: 2, paused: 3,
    pendactivation: 4, completed: 5, canceled: 6,
  }
  for (const enr of enrollments) {
    const existing = enrollmentByCustomer.get(enr.customerId)
    if (!existing) {
      enrollmentByCustomer.set(enr.customerId, enr)
    } else {
      const existingPriority = ENROLLMENT_PRIORITY[existing.status] ?? 99
      const newPriority = ENROLLMENT_PRIORITY[enr.status] ?? 99
      if (newPriority < existingPriority) {
        enrollmentByCustomer.set(enr.customerId, enr)
      }
    }
  }

  // Index: customerId → checkins in 60-day window
  const checkinsByCustomer = new Map<string, PPCheckin[]>()
  for (const chk of checkins) {
    const list = checkinsByCustomer.get(chk.customer) ?? []
    list.push(chk)
    checkinsByCustomer.set(chk.customer, list)
  }

  // Build MemberData for each customer
  // monthlyRevenue is not available from the PushPress API — left as 0 until
  // the owner sets it in context (memories) or the API exposes plan pricing
  const members: MemberDataWithFlags[] = customers.map(customer => {
    const enrollment = enrollmentByCustomer.get(customer.id) ?? null
    const customerCheckins = checkinsByCustomer.get(customer.id) ?? []
    return buildMemberData(customer, enrollment, customerCheckins, now, 0)
  })

  // Surface payment_failed events from 'alert' enrollment status
  const paymentEvents: PaymentEvent[] = []
  for (const member of members) {
    if (member.hasPaymentAlert) {
      paymentEvents.push({
        id: `alert-${member.id}`,
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        eventType: 'payment_failed',
        amount: 0,
        failedAt: new Date().toISOString(),
      })
    }
  }

  // Map checkins to abstract CheckinData (recent 30 days only)
  const recentCheckins = checkins
    .filter(c => c.timestamp >= thirtyDaysAgoMs)
    .map(c => ({
      id: c.id,
      customerId: c.customer,
      timestamp: c.timestamp,
      className: c.name ?? '',
      kind: c.kind,
      role: c.role ?? 'attendee',
      result: c.result ?? 'success',
    }))

  return {
    accountId,
    accountName,
    members,
    recentCheckins,
    recentLeads: [],
    paymentEvents,
    capturedAt: now.toISOString(),
  }
}
