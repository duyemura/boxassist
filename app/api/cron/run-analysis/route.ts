export const dynamic = 'force-dynamic'

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
 *   2. Build AccountSnapshot using pushpress-platform.ts mapping functions
 *   3. Run GMAgent.runAnalysis()
 *   4. Save KPI snapshot
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import { GMAgent } from '@/lib/agents/GMAgent'
import type { AccountSnapshot, PaymentEvent } from '@/lib/agents/GMAgent'
import { createInsightTask } from '@/lib/db/tasks'
import { saveKPISnapshot, getMonthlyRetentionROI } from '@/lib/db/kpi'
import { appendSystemEvent } from '@/lib/db/chat'
import { createArtifact } from '@/lib/artifacts/db'
import type { ResearchSummaryData } from '@/lib/artifacts/types'
import * as dbTasks from '@/lib/db/tasks'
import { sendEmail } from '@/lib/resend'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'
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
// buildAccountSnapshot — accurate field mapping via pushpress-platform.ts
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all PushPress data for a gym and build a AccountSnapshot.
 *
 * Uses the real Platform API v1 endpoints and field names:
 *   GET /customers   → PPCustomer[]  (name is { first, last, nickname })
 *   GET /checkins    → PPCheckin[]   (customer UUID field, timestamp in ms)
 *   GET /enrollments → PPEnrollment[] (status: active|alert|canceled|paused|etc)
 *
 * Auth: API-KEY header (NOT Authorization: Bearer)
 */
async function buildAccountSnapshot(
  accountId: string,
  accountName: string,
  apiKey: string,
  companyId?: string,
  avgMembershipPrice?: number,
): Promise<AccountSnapshot> {
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
  // Use gym's avg_membership_price (from settings or PushPress). Falls back to $150.
  const memberPrice = avgMembershipPrice ?? 150
  const members: MemberDataWithFlags[] = customers.map(customer => {
    const enrollment = enrollmentByCustomer.get(customer.id) ?? null
    const customerCheckins = checkinsByCustomer.get(customer.id) ?? []
    return buildMemberData(customer, enrollment, customerCheckins, now, memberPrice)
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
    accountId,
    accountName,
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
    model: HAIKU,
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
  const { data: accounts, error: gymsError } = await supabaseAdmin
    .from('accounts')
    .select('id, gym_name, pushpress_api_key, pushpress_company_id, avg_membership_price')
    .not('pushpress_api_key', 'is', null)

  if (gymsError) {
    console.error('[run-analysis] Failed to fetch gyms:', gymsError.message)
    return NextResponse.json({ error: gymsError.message }, { status: 500 })
  }

  let gymsAnalyzed = 0
  let totalInsights = 0
  let totalTasksCreated = 0

  for (const account of accounts ?? []) {
    try {
      // Decrypt PushPress API key
      let apiKey: string
      try {
        apiKey = decrypt(account.pushpress_api_key)
      } catch (err) {
        console.error(`[run-analysis] Could not decrypt API key for gym ${account.id}:`, err)
        continue
      }

      // Fetch PushPress data + build snapshot using accurate Platform API v1 types
      let snapshot: AccountSnapshot
      try {
        snapshot = await buildAccountSnapshot(
          account.id,
          account.gym_name ?? 'Gym',
          apiKey,
          account.pushpress_company_id ?? undefined,
          account.avg_membership_price ?? undefined,
        )
      } catch (err) {
        console.error(`[run-analysis] PushPress fetch failed for gym ${account.id}:`, err)
        continue
      }

      // Run GMAgent analysis
      const deps = buildAgentDeps()
      const agent = new GMAgent(deps as any)
      agent.setCreateInsightTask((params) => createInsightTask(params))

      const result = await agent.runAnalysis(account.id, snapshot)

      // Save KPI snapshot
      const activeMembers = snapshot.members.filter(m => m.status === 'active').length
      // Count at-risk members by priority (not hardcoded type) — works with AI-assigned types
      const churnRiskCount = result.insights.filter(
        i => i.priority === 'critical' || i.priority === 'high'
      ).length
      const revenueMtd = snapshot.members
        .filter(m => m.status === 'active')
        .reduce((sum, m) => sum + m.monthlyRevenue, 0)

      await saveKPISnapshot(account.id, {
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
        account.id,
        `GM ran analysis. Found ${result.insightsFound} insight${result.insightsFound !== 1 ? 's' : ''}${result.insightsFound > 0 ? ', added to your To-Do.' : '.'}`,
      )

      // Generate research summary artifact (fire-and-forget)
      if (result.insights.length > 0) {
        generateAnalysisArtifact(
          account.id,
          account.gym_name ?? 'Your Gym',
          result,
          snapshot,
        ).catch(err => {
          console.warn(`[run-analysis] Artifact generation failed for gym ${account.id}:`, (err as Error).message)
        })
      }

      gymsAnalyzed++
      totalInsights += result.insightsFound
      totalTasksCreated += result.tasksCreated

      console.log(
        `[run-analysis] gym=${account.id} insights=${result.insightsFound} tasks=${result.tasksCreated}`
      )
    } catch (err) {
      console.error(`[run-analysis] Unexpected error for gym ${account.id}:`, err)
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

// ── Artifact generation ──────────────────────────────────────────────────────

async function generateAnalysisArtifact(
  accountId: string,
  accountName: string,
  result: { insights: any[]; insightsFound: number; tasksCreated: number },
  snapshot: AccountSnapshot,
) {
  const now = new Date()
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  // Get monthly ROI for the artifact
  let roi = { membersRetained: 0, revenueRetained: 0, messagesSent: 0, conversationsActive: 0, escalations: 0 }
  try {
    roi = await getMonthlyRetentionROI(accountId)
  } catch {
    // Non-fatal
  }

  const priorityToRisk = (p: string) =>
    p === 'critical' ? 'high' : p === 'high' ? 'high' : p === 'medium' ? 'medium' : 'low'

  // Derive member status from insight context — not hardcoded type enum.
  // The AI assigns types freely, so we check keywords in the type string.
  const insightToStatus = (type: string) => {
    if (type.includes('win_back') || type.includes('cancel') || type.includes('churn')) return 'churned' as const
    if (type.includes('lead') || type.includes('prospect') || type.includes('trial')) return 'new' as const
    return 'at_risk' as const
  }

  const artifactData: ResearchSummaryData = {
    accountName,
    generatedAt: now.toISOString(),
    period: monthLabel,
    generatedBy: 'GM Agent',
    stats: {
      // Count at-risk by priority, not hardcoded type — works with AI-assigned types
      membersAtRisk: result.insights.filter(i => i.priority === 'critical' || i.priority === 'high' || i.priority === 'medium').length,
      membersRetained: roi.membersRetained,
      revenueRetained: roi.revenueRetained,
      messagesSent: roi.messagesSent,
      conversationsActive: roi.conversationsActive,
      escalations: roi.escalations,
    },
    members: result.insights.slice(0, 15).map(insight => ({
      name: insight.memberName ?? 'Unknown',
      email: insight.memberEmail,
      status: insightToStatus(insight.type),
      riskLevel: priorityToRisk(insight.priority) as 'high' | 'medium' | 'low',
      detail: insight.detail ?? insight.title,
      membershipValue: undefined,
    })),
    insights: [
      ...result.insights.length > 0
        ? [`${result.insightsFound} members flagged across ${new Set(result.insights.map((i: any) => i.type)).size} categories`]
        : [],
      ...(result.insights.filter((i: any) => i.priority === 'critical').length > 0
        ? [`${result.insights.filter((i: any) => i.priority === 'critical').length} critical priority — review these first`]
        : []),
      ...(roi.membersRetained > 0
        ? [`${roi.membersRetained} members retained this month, saving $${roi.revenueRetained.toLocaleString()}`]
        : []),
    ],
  }

  await createArtifact({
    accountId,
    artifactType: 'research_summary',
    title: `${accountName} — Analysis Summary`,
    data: artifactData as unknown as Record<string, unknown>,
    createdBy: 'gm',
    shareable: true,
  })

  console.log(`[run-analysis] Artifact generated for gym ${accountId}`)
}

// Vercel Cron Jobs send GET requests — also keep POST for manual triggers
export const GET = handler
export const POST = handler
