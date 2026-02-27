/**
 * sync-business-stats.ts
 *
 * Fetches real metrics from PushPress and writes them as a `business_stats`
 * memory. These are plain numbers — factual, refreshable, no opinions.
 *
 * The AI reads these alongside the `gym_context` (business profile) memory
 * when reasoning about a business. Stats refresh on every sync; the profile
 * only changes when the AI learns something new or the owner edits it.
 *
 * Call from: setup/recommend, manual refresh, or analysis cron.
 */

import { createPushPressClient } from './pushpress'
import {
  getAccountMemories,
  updateMemory,
  createMemory,
} from './db/memories'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusinessInfo {
  name: string
  address?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  subdomain?: string              // PushPress subdomain / website
  phone?: string
  timezone?: string
}

export interface BusinessStats {
  // Business info
  businessInfo: BusinessInfo

  // Member breakdown
  totalMembers: number
  active: number
  paused: number
  cancelled: number
  leads: number
  newLast30Days: number
  cancelledLast30Days: number

  // Revenue
  estimatedMRR: number

  syncedAt: string
}

export interface SyncResult {
  stats: BusinessStats
  memoryId: string
}

// ── Core sync function ────────────────────────────────────────────────────────

/**
 * Fetch current metrics from PushPress v3 and write/update business_stats memory.
 */
export async function syncBusinessStats(
  accountId: string,
  apiKey: string,
  companyId: string,
  avgMembershipPrice: number,
): Promise<SyncResult> {
  const client = createPushPressClient(apiKey, companyId)
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  // ── Fetch company info ──────────────────────────────────────────────────

  const businessInfo = await fetchCompanyInfo(client)

  // ── Fetch all customers (paginated) ─────────────────────────────────────

  const customers: any[] = []
  let page = 1
  const MAX_PAGES = 5
  while (page <= MAX_PAGES) {
    const response = await client.fetch(`/customers?limit=100&page=${page}`)
    const batch: any[] =
      response?.data?.resultArray ??
      response?.data ??
      response?.resultArray ??
      (Array.isArray(response) ? response : [])
    if (!Array.isArray(batch) || batch.length === 0) break
    customers.push(...batch)
    if (batch.length < 100) break
    page++
  }

  // ── Classify members ────────────────────────────────────────────────────

  let active = 0, paused = 0, cancelled = 0, leads = 0
  let newLast30Days = 0, cancelledLast30Days = 0

  for (const c of customers) {
    const status = mapStatus(c)
    const memberSince = parseDateField(c, sixMonthsAgo)

    if (status === 'prospect') { leads++; continue }
    if (status === 'cancelled') {
      cancelled++
      if (memberSince >= thirtyDaysAgo) cancelledLast30Days++
      continue
    }
    if (status === 'paused') { paused++; continue }

    active++
    if (memberSince >= thirtyDaysAgo) newLast30Days++
  }

  const stats: BusinessStats = {
    businessInfo,
    totalMembers: customers.length,
    active,
    paused,
    cancelled,
    leads,
    newLast30Days,
    cancelledLast30Days,
    estimatedMRR: active * avgMembershipPrice,
    syncedAt: now.toISOString(),
  }

  const memoryId = await writeStatsMemory(accountId, stats)
  return { stats, memoryId }
}

// ── Fetch company info from /company endpoint ───────────────────────────────

async function fetchCompanyInfo(
  client: ReturnType<typeof createPushPressClient>,
): Promise<BusinessInfo> {
  const info: BusinessInfo = { name: '' }

  try {
    const raw = await client.fetch('/company')
    const co = raw?.data ?? raw

    info.name = co?.name || ''

    // Address fields — try multiple conventions
    const addr = co?.address || co
    info.address = addr?.address || addr?.street || addr?.line1 || addr?.address1 || ''
    info.city = addr?.city || ''
    info.state = addr?.state || addr?.province || addr?.region || ''
    info.postalCode = addr?.zip || addr?.postalCode || addr?.postal_code || addr?.zipcode || ''
    info.country = addr?.country || ''
    info.subdomain = co?.subdomain || co?.slug || ''
    info.phone = co?.phone || co?.phoneNumber || co?.phone_number || ''
    info.timezone = co?.timezone || co?.tz || ''

    console.log('[sync] /company fields:', Object.keys(co || {}).join(', '))
  } catch (err: any) {
    console.log('[sync] /company failed (non-blocking):', err.message)
  }

  return info
}

// ── Write stats from an existing snapshot (avoids double-fetching) ───────────

/**
 * Build stats from a snapshot that was already fetched (e.g. by the recommend
 * endpoint) and write them to the business_stats memory.
 */
export async function writeStatsFromSnapshot(
  accountId: string,
  snapshot: {
    accountName: string
    members: Array<{
      status: string
      memberSince: string
      monthlyRevenue: number
    }>
  },
  avgMembershipPrice: number,
): Promise<string> {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  let active = 0, paused = 0, cancelled = 0, leads = 0
  let newLast30Days = 0, cancelledLast30Days = 0

  for (const m of snapshot.members) {
    const memberSince = new Date(m.memberSince)

    if (m.status === 'prospect') { leads++; continue }
    if (m.status === 'cancelled') {
      cancelled++
      if (!isNaN(memberSince.getTime()) && memberSince >= thirtyDaysAgo) cancelledLast30Days++
      continue
    }
    if (m.status === 'paused') { paused++; continue }

    active++
    if (!isNaN(memberSince.getTime()) && memberSince >= thirtyDaysAgo) newLast30Days++
  }

  const stats: BusinessStats = {
    businessInfo: { name: snapshot.accountName },
    totalMembers: snapshot.members.length,
    active,
    paused,
    cancelled,
    leads,
    newLast30Days,
    cancelledLast30Days,
    estimatedMRR: active * avgMembershipPrice,
    syncedAt: now.toISOString(),
  }

  return writeStatsMemory(accountId, stats)
}

// ── Format stats as a memory string ─────────────────────────────────────────

export function formatStatsForMemory(stats: BusinessStats): string {
  const lines: string[] = []

  // Business info
  const bi = stats.businessInfo
  if (bi.city || bi.state) {
    const location = [bi.city, bi.state].filter(Boolean).join(', ')
    const extra = [bi.postalCode, bi.country].filter(Boolean).join(' ')
    lines.push(`Location: ${location}${extra ? ' ' + extra : ''}`)
  }
  if (bi.phone) lines.push(`Phone: ${bi.phone}`)
  if (bi.timezone) lines.push(`Timezone: ${bi.timezone}`)

  // Member breakdown
  const parts = [`${stats.active} active`]
  if (stats.paused > 0) parts.push(`${stats.paused} paused`)
  if (stats.cancelled > 0) parts.push(`${stats.cancelled} cancelled`)
  if (stats.leads > 0) parts.push(`${stats.leads} leads`)
  lines.push(`Members: ${stats.totalMembers} total (${parts.join(', ')})`)

  // 30-day changes
  if (stats.newLast30Days > 0 || stats.cancelledLast30Days > 0) {
    const changes: string[] = []
    if (stats.newLast30Days > 0) changes.push(`+${stats.newLast30Days} new`)
    if (stats.cancelledLast30Days > 0) changes.push(`-${stats.cancelledLast30Days} cancelled`)
    lines.push(`Last 30 days: ${changes.join(', ')}`)
  }

  // Revenue
  if (stats.estimatedMRR > 0) {
    const mrr = stats.estimatedMRR >= 1000
      ? `$${Math.round(stats.estimatedMRR / 1000)}k`
      : `$${Math.round(stats.estimatedMRR)}`
    lines.push(`Estimated MRR: ${mrr}/mo`)
  }

  // Sync time
  const syncDate = new Date(stats.syncedAt)
  lines.push(`Last synced: ${syncDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)

  return lines.join('\n')
}

// ── Write/update the business_stats memory ──────────────────────────────────

async function writeStatsMemory(accountId: string, stats: BusinessStats): Promise<string> {
  const content = formatStatsForMemory(stats)

  const existing = await getAccountMemories(accountId, { category: 'business_stats' })
  const statsMemory = existing.find(m => m.source === 'system')

  if (statsMemory) {
    await updateMemory(statsMemory.id, { content })
    return statsMemory.id
  }

  const created = await createMemory({
    accountId,
    category: 'business_stats',
    content,
    importance: 5,
    scope: 'global',
    source: 'system',
  })
  return created.id
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapStatus(customer: any): 'active' | 'paused' | 'cancelled' | 'prospect' {
  const role = customer.role || customer.customer_role || ''
  const status = customer.status || ''

  if (role === 'lead' || status === 'lead') return 'prospect'
  if (role === 'ex-member' || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (role === 'non-member') return 'cancelled'
  if (status === 'paused' || status === 'frozen') return 'paused'
  return 'active'
}

function parseDateField(customer: any, fallback: Date): Date {
  const raw =
    customer.memberSince || customer.member_since ||
    customer.joinDate || customer.join_date ||
    customer.startDate || customer.start_date ||
    customer.created_at || customer.createdAt ||
    customer.date_added || customer.dateAdded
  if (!raw) return fallback
  const d = new Date(raw)
  return isNaN(d.getTime()) ? fallback : d
}
