/**
 * POST /api/cron/run-analysis
 *
 * Vercel Cron endpoint — runs GMAgent analysis for all connected gyms.
 * Called every 6 hours by Vercel Cron.
 * Validates CRON_SECRET header before processing.
 *
 * vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/run-analysis", "schedule": "0 every6h * * *" }]
 * }
 *
 * For each gym:
 *   1. Fetch PushPress data via Platform API v1 (accurate field names from OpenAPI spec)
 *   2. Build GymSnapshot using pushpress-platform.ts mapping functions
 *   3. Run GMAgent.runAnalysis()
 *   4. Save KPI snapshot
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import { GMAgent } from '@/lib/agents/GMAgent'
import type { GymSnapshot, PaymentEvent } from '@/lib/agents/GMAgent'
import { createInsightTask } from '@/lib/db/tasks'
import { saveKPISnapshot } from '@/lib/db/kpi'
import { appendSystemEvent } from '@/lib/db/chat'
import * as dbTasks from '@/lib/db/tasks'
import { sendEmail } from '@/lib/resend'
import Anthropic from '@anthropic-ai/sdk'
import {
  ppGet,
  buildMemberData,
  PP_PLATFORM_BASE,
} from '@/lib/pushpress-platform'
import type {
  PPCustomer,
  PPEnrollment,
  PPCheckin,
  MemberDataWithFlags,
} from '@/lib/pushpress-platform'

// ──────────────────────────────────────────────────────────────────────────────
// buildGymSnapshot — accurate field mapping via pushpress-platform.ts
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all PushPress data for a gym and build a GymSnapshot.
 *
 * Uses the real Platform API v1 endpoints and field names:
 *   GET /customers   → PPCustomer[]  (name is { first, last, nickname })
 *   GET /checkins    → PPCheckin[]   (customer UUID field, timestamp in ms)
 *   GET /enrollments → PPEnrollment[] (status: active|alert|canceled|paused|etc)
 *
 * Auth: API-KEY header (NOT Authorization: Bearer)
 */
async function buildGymSnapshot(
  gymId: string,
  gymName: string,
  apiKey: string,
  companyId?: string,
): Promise<GymSnapshot> {
  const now = new Date()
  const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const sixtyDaysAgoMs  = now.getTime() - 60 * 24 * 60 * 60 * 1000

  // Fetch customers, enrollments, and checkins (60-day window) in parallel.
  // Checkin timestamps are unix ms — convert to ISO for query params.
  const sixtyDaysAgoSec = Math.floor(sixtyDaysAgoMs / 1000)
  const nowSec = Math.floor(now.getTime() / 1000)

  const [customers, enrollments, checkins] = await Promise.all([
    ppGet<PPCustomer>(apiKey, '/customers', {}, companyId),
    ppGet<PPEnrollment>(apiKey, '/enrollments', {}, companyId),
    ppGet<PPCheckin>(apiKey, '/checkins', {
      // The spec uses unix seconds for query params (start/end of class)
      // but checkin.timestamp itself is unix ms
      startTimestamp: String(sixtyDaysAgoSec),
      endTimestamp: String(nowSec),
    }, companyId),
  ])

  // Index: customerId → most recent active enrollment
  // A customer may have multiple enrollments — use the active/alert one first,
  // fall back to the most recently started.
  const enrollmentByCustomer = new Map<string, PPEnrollment>()
  const ACTIVE_PRIORITY: Record<string, number> = {
    active: 0, alert: 1, pendcancel: 2, paused: 3,
    pendactivation: 4, completed: 5, canceled: 6,
  }
  for (const enr of enrollments) {
    const existing = enrollmentByCustomer.get(enr.customerId)
    if (!existing) {
      enrollmentByCustomer.set(enr.customerId, enr)
    } else {
      const existingPriority = ACTIVE_PRIORITY[existing.status] ?? 99
      const newPriority = ACTIVE_PRIORITY[enr.status] ?? 99
      if (newPriority < existingPriority) {
        enrollmentByCustomer.set(enr.customerId, enr)
      }
    }
  }

  // Index: customerId → checkins in 60-day window
  // Key: checkin.customer is the UUID (NOT customerId)
  const checkinsByCustomer = new Map<string, PPCheckin[]>()
  for (const chk of checkins) {
    const list = checkinsByCustomer.get(chk.customer) ?? []
    list.push(chk)
    checkinsByCustomer.set(chk.customer, list)
  }

  // Build MemberData for each customer
  // Monthly revenue: we don't have plan amounts from the API without fetching /plans.
  // Use a placeholder of 0 — gym owner knows their prices. Future: fetch /plans.
  const members: MemberDataWithFlags[] = customers.map(customer => {
    const enrollment = enrollmentByCustomer.get(customer.id) ?? null
    const customerCheckins = checkinsByCustomer.get(customer.id) ?? []
    return buildMemberData(customer, enrollment, customerCheckins, now, 0)
  })

  // Surface payment_failed insights from 'alert' enrollment status
  // (alert = payment failed — enrollment is still active but payment is broken)
  const paymentEvents: PaymentEvent[] = []
  for (const member of members) {
    if (member.hasPaymentAlert) {
      paymentEvents.push({
        id: `alert-${member.id}`,
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        eventType: 'payment_failed',
        amount: member.monthlyRevenue,
        failedAt: new Date().toISOString(),
      })
    }
  }

  // Map checkins to CheckinData for the snapshot (recent 30 days only)
  const recentCheckins = checkins
    .filter(c => c.timestamp >= thirtyDaysAgoMs)
    .map(c => ({
      id: c.id,
      customerId: c.customer,    // normalise to customerId for internal use
      timestamp: c.timestamp,
      className: c.name ?? '',
      kind: c.kind,
      role: c.role ?? 'attendee',
      result: c.result ?? 'success',
    }))

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

async function handler(req: NextRequest): Promise<NextResponse> {
  // Validate CRON_SECRET — Vercel sends Authorization: Bearer <CRON_SECRET> on GET
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[run-analysis] Starting gym analysis cron')

  // Fetch all connected gyms
  const { data: gyms, error: gymsError } = await supabaseAdmin
    .from('gyms')
    .select('id, gym_name, pushpress_api_key, pushpress_company_id')
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

      // Fetch PushPress data + build snapshot using accurate Platform API v1 types
      let snapshot: GymSnapshot
      try {
        snapshot = await buildGymSnapshot(
          gym.id,
          gym.gym_name ?? 'Gym',
          apiKey,
          gym.pushpress_company_id ?? undefined,
        )
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

      // Append system event to the unified GM chat log
      await appendSystemEvent(
        gym.id,
        `GM ran analysis. Found ${result.insightsFound} insight${result.insightsFound !== 1 ? 's' : ''}${result.insightsFound > 0 ? ', added to your To-Do.' : '.'}`,
      )

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

// Vercel Cron Jobs send GET requests — also keep POST for manual triggers
export const GET = handler
export const POST = handler
