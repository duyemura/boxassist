export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAccountForUser } from '@/lib/db/accounts'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import { createPushPressClient } from '@/lib/pushpress'
import { recommend } from '@/lib/setup-recommend'
import { writeStatsFromSnapshot } from '@/lib/sync-business-stats'
import { writeScheduleFromSnapshot } from '@/lib/sync-schedule'
import type { AccountSnapshot, MemberData } from '@/lib/agents/GMAgent'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const SNAPSHOT_CACHE_CATEGORY = 'setup_snapshot_cache'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Allow ?force=true to bypass cache
  const forceRefresh = new URL(req.url).searchParams.get('force') === 'true'

  try {
    const account = await getAccountForUser(session.id)
    if (!account) {
      return NextResponse.json({ error: 'No gym connected — connect your PushPress account first' }, { status: 400 })
    }

    const accountId = (account as any).id
    const { data: accountRow, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('pushpress_api_key, pushpress_company_id, account_name, member_count, avg_membership_price')
      .eq('id', accountId)
      .single()

    if (fetchErr || !accountRow?.pushpress_api_key) {
      return NextResponse.json({ error: 'No PushPress connection found — reconnect your gym\'s PushPress account' }, { status: 400 })
    }

    const accountName = accountRow.account_name || 'Your Gym'

    // ── Check for recent knowledge pull ──────────────────────────────────────
    // If business_stats memory was updated < 24h ago, skip the expensive
    // PushPress data fetch and build the recommendation from cached snapshot.

    if (!forceRefresh) {
      const { data: recentStats } = await supabaseAdmin
        .from('memories')
        .select('updated_at')
        .eq('account_id', accountId)
        .eq('category', 'business_stats')
        .eq('source', 'system')
        .eq('active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single()

      if (recentStats?.updated_at) {
        const age = Date.now() - new Date(recentStats.updated_at).getTime()
        if (age < CACHE_TTL_MS) {
          console.log(`[setup/recommend] Using cached data (${Math.round(age / 60_000)}m old) for ${accountName}`)

          // We still need the snapshot to generate a recommendation, but we can
          // use the member_count from accounts table as a fast approximation
          // and build a lightweight snapshot from existing data.
          const cachedSnapshot = await buildCachedSnapshot(accountId, accountName)
          if (cachedSnapshot) {
            const recommendation = recommend(cachedSnapshot)
            return NextResponse.json({
              recommendation,
              snapshotSummary: {
                totalMembers: cachedSnapshot.members.length,
                accountName,
              },
              cached: true,
              lastSyncedAt: recentStats.updated_at,
            })
          }
          // If cached snapshot failed, fall through to fresh fetch
        }
      }
    }

    // ── Fresh data pull from PushPress ────────────────────────────────────────

    const apiKey = decrypt(accountRow.pushpress_api_key)
    const companyId = accountRow.pushpress_company_id || ''

    console.log('[setup/recommend] Fetching fresh data for', accountName)

    const snapshot = await buildQuickSnapshot(apiKey, companyId, accountId, accountName)

    console.log('[setup/recommend] Snapshot:', snapshot.members.length, 'members')

    const recommendation = recommend(snapshot)

    console.log('[setup/recommend] Recommendation:', recommendation.agentType, '-', recommendation.name)

    // Write business stats + schedule memories with accurate data from paginated fetch.
    // Also cache the compact snapshot so the next visit can skip the PushPress fetch.
    const avgPrice = accountRow.avg_membership_price ?? 150
    await Promise.all([
      writeStatsFromSnapshot(accountId, snapshot, avgPrice),
      writeScheduleFromSnapshot(accountId, snapshot),
      cacheSnapshotForSetup(accountId, snapshot),
    ])

    return NextResponse.json({
      recommendation,
      snapshotSummary: {
        totalMembers: snapshot.members.length,
        accountName,
      },
      cached: false,
      lastSyncedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[setup/recommend] Error:', err.message)
    return NextResponse.json(
      { error: err.message || 'Failed to analyze your business' },
      { status: 500 },
    )
  }
}

/**
 * Save a compact snapshot to the memories table so the next setup visit
 * can skip the PushPress API call. Importance=1 keeps it below the
 * minImportance=3 threshold used for AI prompt injection.
 */
async function cacheSnapshotForSetup(accountId: string, snapshot: AccountSnapshot): Promise<void> {
  const compact = {
    members: snapshot.members.map(m => ({
      id: m.id,
      st: m.status,
      ms: m.memberSince,
      r: m.recentCheckinsCount,
      p: m.previousCheckinsCount,
    })),
    pe: snapshot.paymentEvents ?? [],
  }

  try {
    const { data: existing } = await supabaseAdmin
      .from('memories')
      .select('id')
      .eq('account_id', accountId)
      .eq('category', SNAPSHOT_CACHE_CATEGORY)
      .limit(1)
      .single()

    if (existing) {
      await supabaseAdmin
        .from('memories')
        .update({ content: JSON.stringify(compact), updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin.from('memories').insert({
        account_id: accountId,
        category: SNAPSHOT_CACHE_CATEGORY,
        content: JSON.stringify(compact),
        importance: 1,
        scope: 'global',
        source: 'system',
      })
    }
  } catch (err: any) {
    // Non-critical — fresh fetch still worked; just means next visit won't be cached
    console.warn('[setup/recommend] Failed to cache snapshot:', err.message)
  }
}

/**
 * Read the compact snapshot saved by cacheSnapshotForSetup.
 * Returns null if no cache exists or if parsing fails.
 */
async function buildCachedSnapshot(
  accountId: string,
  accountName: string,
): Promise<AccountSnapshot | null> {
  try {
    const { data: cached } = await supabaseAdmin
      .from('memories')
      .select('content')
      .eq('account_id', accountId)
      .eq('category', SNAPSHOT_CACHE_CATEGORY)
      .limit(1)
      .single()

    if (!cached?.content) return null

    const compact = JSON.parse(cached.content)
    if (!Array.isArray(compact.members)) return null

    const members: MemberData[] = compact.members.map((m: any) => ({
      id: m.id ?? '',
      name: '',
      email: '',
      status: m.st ?? 'active',
      membershipType: '',
      memberSince: m.ms ?? '',
      recentCheckinsCount: m.r ?? 0,
      previousCheckinsCount: m.p ?? 0,
      monthlyRevenue: 0,
    }))

    return {
      accountId,
      accountName,
      members,
      recentCheckins: [],
      recentLeads: [],
      paymentEvents: compact.pe ?? [],
      capturedAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Build a lightweight AccountSnapshot using the PushPress v3 API.
 * Fetches customers (paginated) + recent checkins for a sample of members.
 * Good enough for a recommendation — doesn't need the full Platform v1 data.
 */
async function buildQuickSnapshot(
  apiKey: string,
  companyId: string,
  accountId: string,
  accountName: string,
): Promise<AccountSnapshot> {
  const client = createPushPressClient(apiKey, companyId)
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  // Step 1: Fetch all customers (paginated — v3 caps at 100 per page)
  let customers: any[] = []
  try {
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
      if (batch.length < 100) break // last page
      page++
    }
  } catch (err: any) {
    console.error('[setup/recommend] /customers failed:', err.message)
    throw new Error(`Could not fetch member data from PushPress: ${err.message}`)
  }

  console.log('[setup/recommend] Fetched', customers.length, 'customers total')

  // Log a sample customer to see actual field names
  if (customers.length > 0) {
    console.log('[setup/recommend] Sample customer keys:', Object.keys(customers[0]))
    console.log('[setup/recommend] Sample customer:', JSON.stringify(customers[0]).slice(0, 800))
  }

  // Step 2: For a sample of active members, fetch recent checkins to assess attendance
  const sampleSize = Math.min(customers.length, 30)
  const members: MemberData[] = []

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]
    const name = formatV3Name(c)
    const email = c.email || ''
    const status = mapV3Status(c)

    // For the sample, fetch checkins to get attendance data
    let recentCheckinsCount = 0
    let previousCheckinsCount = 0

    if (i < sampleSize && (status === 'active' || status === 'paused')) {
      try {
        const checkinResp = await client.fetch(`/checkins/class?customer=${c.id}&limit=50`)
        const checkins: any[] =
          checkinResp?.data?.resultArray ??
          checkinResp?.data ??
          (Array.isArray(checkinResp) ? checkinResp : [])

        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

        for (const chk of checkins) {
          const d = new Date(chk.date || chk.checkedInAt || chk.created_at || chk.createdAt)
          if (isNaN(d.getTime())) continue
          if (d >= thirtyDaysAgo) recentCheckinsCount++
          else if (d >= sixtyDaysAgo) previousCheckinsCount++
        }
      } catch {
        // Skip checkin fetch failures — still include the member
      }
    }

    // memberSince: try multiple field names, default to 6 months ago (not now)
    const memberSince =
      c.memberSince || c.member_since || c.joinDate || c.join_date ||
      c.startDate || c.start_date || c.created_at || c.createdAt ||
      c.date_added || c.dateAdded ||
      sixMonthsAgo.toISOString()

    members.push({
      id: c.id || `member-${i}`,
      name,
      email,
      status,
      membershipType: c.membership_type || c.membershipType || c.plan || 'Monthly',
      memberSince,
      recentCheckinsCount,
      previousCheckinsCount,
      monthlyRevenue: 0,
    })
  }

  return {
    accountId,
    accountName,
    members,
    recentCheckins: [],
    recentLeads: [],
    paymentEvents: [],
    capturedAt: now.toISOString(),
  }
}

function formatV3Name(customer: any): string {
  const first = customer.first_name || customer.firstName || ''
  const last = customer.last_name || customer.lastName || ''
  const full = `${first} ${last}`.trim()
  return full || customer.name || customer.email || 'Member'
}

function mapV3Status(customer: any): MemberData['status'] {
  const role = customer.role || customer.customer_role || ''
  const status = customer.status || ''

  if (role === 'lead' || status === 'lead') return 'prospect'
  if (role === 'ex-member' || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (role === 'non-member') return 'cancelled'
  if (status === 'paused' || status === 'frozen') return 'paused'
  return 'active'
}
