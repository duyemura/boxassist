/**
 * POST /api/cron/run-analysis
 *
 * Vercel Cron endpoint — runs GMAgent analysis for all connected gyms.
 * Called every 6 hours by Vercel Cron.
 * Validates CRON_SECRET header before processing.
 *
 * vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/run-analysis", "schedule": "0 * /6 * * *" }]
 * }
 *
 * For each gym:
 *   1. Fetch PushPress data (customers, checkins, enrollments, payment events)
 *   2. Build GymSnapshot
 *   3. Run GMAgent.runAnalysis()
 *   4. Save KPI snapshot
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import { GMAgent } from '@/lib/agents/GMAgent'
import type {
  GymSnapshot,
  MemberData,
  CheckinData,
  PaymentEvent,
} from '@/lib/agents/GMAgent'
import { createInsightTask } from '@/lib/db/tasks'
import { saveKPISnapshot } from '@/lib/db/kpi'
import * as dbTasks from '@/lib/db/tasks'
import { sendEmail } from '@/lib/resend'
import Anthropic from '@anthropic-ai/sdk'

// ──────────────────────────────────────────────────────────────────────────────
// PushPress Platform API v1 (OpenAPI spec field names)
// ──────────────────────────────────────────────────────────────────────────────

const PP_BASE = 'https://api.pushpress.com/platform/v1'

interface PPApiCustomer {
  id: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  status?: string        // 'active' | 'cancelled' | 'paused' | etc
  createdAt?: string
}

interface PPApiCheckin {
  id: string
  customerId: string
  timestamp?: number     // unix ms
  createdAt?: string
  className?: string
  kind?: string          // 'class' | 'appointment' | 'event' | 'open'
  role?: string          // 'staff' | 'coach' | 'assistant' | 'attendee'
  result?: string        // 'success' | 'failure'
}

interface PPApiBillingSchedule {
  period?: string        // 'month' | 'week' | 'year' | 'day'
  amount?: number
}

interface PPApiEnrollment {
  id: string
  customerId: string
  status?: string        // 'active' | 'cancelled' | etc
  nextCharge?: string    // ISO date — renewal date
  billingSchedule?: PPApiBillingSchedule
}

async function ppGet<T>(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const url = new URL(`${PP_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PushPress API ${res.status} ${path}: ${text}`)
  }

  const body = await res.json()
  // Handle both { data: [...] } and [...] shapes
  return (Array.isArray(body) ? body : body.data ?? []) as T[]
}

/**
 * Normalize billing schedule period to monthly revenue.
 */
function normalizeMonthlyRevenue(schedule?: PPApiBillingSchedule): number {
  if (!schedule?.amount) return 0
  const amount = schedule.amount
  switch (schedule.period) {
    case 'month': return amount
    case 'week': return amount * 4.33
    case 'year': return amount / 12
    case 'day': return amount * 30
    default: return amount
  }
}

/**
 * Map PushPress customer status to MemberData status.
 */
function mapMemberStatus(ppStatus?: string): MemberData['status'] {
  switch (ppStatus) {
    case 'active': return 'active'
    case 'cancelled':
    case 'canceled': return 'cancelled'
    case 'paused':
    case 'pendpause': return 'paused'
    case 'prospect':
    case 'lead': return 'prospect'
    default: return 'active'
  }
}

/**
 * Fetch all PushPress data for a gym and build a GymSnapshot.
 */
async function buildGymSnapshot(
  gymId: string,
  gymName: string,
  apiKey: string,
): Promise<GymSnapshot> {
  const now = new Date()

  // Date window: 60 days ago for attendance comparison
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const sixtyDaysAgo = new Date(now)
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

  // Fetch in parallel
  const [customers, recentCheckinData, olderCheckinData, enrollments] = await Promise.all([
    ppGet<PPApiCustomer>(apiKey, '/customers'),
    ppGet<PPApiCheckin>(apiKey, '/checkins', {
      startDate: thirtyDaysAgo.toISOString(),
      endDate: now.toISOString(),
      kind: 'class',
      role: 'attendee',
      result: 'success',
    }),
    ppGet<PPApiCheckin>(apiKey, '/checkins', {
      startDate: sixtyDaysAgo.toISOString(),
      endDate: thirtyDaysAgo.toISOString(),
      kind: 'class',
      role: 'attendee',
      result: 'success',
    }),
    ppGet<PPApiEnrollment>(apiKey, '/enrollments'),
  ])

  // Index enrollments by customerId for O(1) lookup
  const enrollmentByCustomer = new Map<string, PPApiEnrollment>()
  for (const enroll of enrollments) {
    if (!enrollmentByCustomer.has(enroll.customerId)) {
      enrollmentByCustomer.set(enroll.customerId, enroll)
    }
  }

  // Count checkins per customer for both windows
  const recentCountByCustomer = new Map<string, number>()
  const recentLastCheckinByCustomer = new Map<string, number>()
  for (const c of recentCheckinData) {
    const count = (recentCountByCustomer.get(c.customerId) ?? 0) + 1
    recentCountByCustomer.set(c.customerId, count)
    const ts = c.timestamp ?? (c.createdAt ? new Date(c.createdAt).getTime() : 0)
    const existing = recentLastCheckinByCustomer.get(c.customerId) ?? 0
    if (ts > existing) recentLastCheckinByCustomer.set(c.customerId, ts)
  }

  const olderCountByCustomer = new Map<string, number>()
  for (const c of olderCheckinData) {
    const count = (olderCountByCustomer.get(c.customerId) ?? 0) + 1
    olderCountByCustomer.set(c.customerId, count)
  }

  // Build MemberData array
  const members: MemberData[] = customers.map(customer => {
    const enrollment = enrollmentByCustomer.get(customer.id)
    const lastTs = recentLastCheckinByCustomer.get(customer.id)

    return {
      id: customer.id,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email || customer.id,
      email: customer.email ?? '',
      phone: customer.phone,
      status: mapMemberStatus(enrollment?.status ?? customer.status),
      membershipType: enrollment ? 'enrolled' : 'no_membership',
      memberSince: customer.createdAt ?? now.toISOString(),
      lastCheckinAt: lastTs ? new Date(lastTs).toISOString() : undefined,
      recentCheckinsCount: recentCountByCustomer.get(customer.id) ?? 0,
      previousCheckinsCount: olderCountByCustomer.get(customer.id) ?? 0,
      renewalDate: enrollment?.nextCharge,
      monthlyRevenue: normalizeMonthlyRevenue(enrollment?.billingSchedule),
    }
  })

  // Map recent checkins to CheckinData
  const recentCheckins: CheckinData[] = recentCheckinData.map(c => ({
    id: c.id,
    customerId: c.customerId,
    timestamp: c.timestamp ?? (c.createdAt ? new Date(c.createdAt).getTime() : 0),
    className: c.className ?? '',
    kind: (c.kind as CheckinData['kind']) ?? 'class',
    role: (c.role as CheckinData['role']) ?? 'attendee',
    result: (c.result as CheckinData['result']) ?? 'success',
  }))

  // No payment events from polling — those come from webhooks
  // Cron can query failed payments from Supabase events table if needed
  const paymentEvents: PaymentEvent[] = []

  return {
    gymId,
    gymName,
    members,
    recentCheckins,
    recentLeads: [],
    paymentEvents,
    capturedAt: now.toISOString(),
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Simple Claude evaluate helper for cron context
// ──────────────────────────────────────────────────────────────────────────────

async function claudeEvaluate(system: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 512,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = response.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text : ''
}

// ──────────────────────────────────────────────────────────────────────────────
// Build AgentDeps for GMAgent
// ──────────────────────────────────────────────────────────────────────────────

function buildAgentDeps() {
  return {
    db: {
      getTask: dbTasks.getTask,
      updateTaskStatus: dbTasks.updateTaskStatus,
      appendConversation: dbTasks.appendConversation,
      getConversationHistory: dbTasks.getConversationHistory,
      createOutboundMessage: async () => { throw new Error('not used in analysis') },
      updateOutboundMessageStatus: async () => { throw new Error('not used in analysis') },
    },
    events: {
      publishEvent: async () => 'noop',
    },
    mailer: {
      sendEmail: async (params: any) => {
        await sendEmail(params)
        return { id: 'noop' }
      },
    },
    claude: {
      evaluate: claudeEvaluate,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/cron/run-analysis
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Validate CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[run-analysis] Starting gym analysis cron')

  // Fetch all connected gyms
  const { data: gyms, error: gymsError } = await supabaseAdmin
    .from('gyms')
    .select('id, gym_name, pushpress_api_key')
    .not('pushpress_api_key', 'is', null)

  if (gymsError) {
    console.error('[run-analysis] Failed to fetch gyms:', gymsError.message)
    return NextResponse.json({ error: gymsError.message }, { status: 500 })
  }

  let gymsAnalyzed = 0
  let totalInsights = 0
  let totalTasksCreated = 0

  for (const gym of gyms ?? []) {
    try {
      // Decrypt PushPress API key
      let apiKey: string
      try {
        apiKey = decrypt(gym.pushpress_api_key)
      } catch (err) {
        console.error(`[run-analysis] Could not decrypt API key for gym ${gym.id}:`, err)
        continue
      }

      // Fetch PushPress data + build snapshot
      let snapshot: GymSnapshot
      try {
        snapshot = await buildGymSnapshot(gym.id, gym.gym_name ?? 'Gym', apiKey)
      } catch (err) {
        console.error(`[run-analysis] PushPress fetch failed for gym ${gym.id}:`, err)
        continue
      }

      // Run GMAgent analysis
      const deps = buildAgentDeps()
      const agent = new GMAgent(deps as any)
      agent.setCreateInsightTask((params) => createInsightTask(params))

      const result = await agent.runAnalysis(gym.id, snapshot)

      // Save KPI snapshot
      const activeMembers = snapshot.members.filter(m => m.status === 'active').length
      const churnRiskCount = result.insights.filter(
        i => i.type === 'churn_risk' || i.type === 'renewal_at_risk'
      ).length
      const revenueMtd = snapshot.members
        .filter(m => m.status === 'active')
        .reduce((sum, m) => sum + m.monthlyRevenue, 0)

      await saveKPISnapshot(gym.id, {
        activeMembers,
        churnRiskCount,
        revenueMtd,
        insightsGenerated: result.insightsFound,
        rawData: {
          snapshotCapturedAt: snapshot.capturedAt,
          totalMembers: snapshot.members.length,
        },
      })

      gymsAnalyzed++
      totalInsights += result.insightsFound
      totalTasksCreated += result.tasksCreated

      console.log(
        `[run-analysis] gym=${gym.id} insights=${result.insightsFound} tasks=${result.tasksCreated}`
      )
    } catch (err) {
      console.error(`[run-analysis] Unexpected error for gym ${gym.id}:`, err)
      // Continue to next gym — never abort the whole run
    }
  }

  console.log(
    `[run-analysis] Done. gymsAnalyzed=${gymsAnalyzed} insights=${totalInsights} tasks=${totalTasksCreated}`
  )

  return NextResponse.json({
    ok: true,
    gymsAnalyzed,
    totalInsights,
    totalTasksCreated,
  })
}
