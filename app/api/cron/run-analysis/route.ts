export const dynamic = 'force-dynamic'

/**
 * POST /api/cron/run-analysis
 *
 * Vercel Cron endpoint — runs active agents for all connected accounts.
 * Called every 6 hours by Vercel Cron.
 *
 * For each account:
 *   1. Build AccountSnapshot via connector (pushpress-platform.ts)
 *   2. Fetch active cron-triggered agents (agents table)
 *   3. Run each agent through the generic agent-runtime
 *   4. Create tasks from insights, save KPI snapshot + artifact
 *
 * This route is infrastructure — it fetches credentials, builds the snapshot,
 * and dispatches to agents. Each agent's behavior is defined by its skill file
 * + business memories + optional owner override. No hardcoded domain logic.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/encrypt'
import type { AccountSnapshot, AccountInsight } from '@/lib/agents/GMAgent'
import { runAgentAnalysis } from '@/lib/agents/agent-runtime'
import { createInsightTask } from '@/lib/db/tasks'
import { saveKPISnapshot, getMonthlyRetentionROI } from '@/lib/db/kpi'
import { appendSystemEvent } from '@/lib/db/chat'
import { createArtifact } from '@/lib/artifacts/db'
import type { ResearchSummaryData } from '@/lib/artifacts/types'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'
import { buildAccountSnapshot } from '@/lib/pushpress-platform'

// ──────────────────────────────────────────────────────────────────────────────
// Claude evaluate helper — shared across all agent runs
// ──────────────────────────────────────────────────────────────────────────────

function makeClaudeEvaluate() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  return async function claudeEvaluate(system: string, prompt: string): Promise<string> {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = response.content.find(b => b.type === 'text')
    return block?.type === 'text' ? block.text : ''
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────

async function handler(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[run-agents] Starting agent cron')

  // Fetch all connected accounts
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from('accounts')
    .select('id, gym_name, pushpress_api_key, pushpress_company_id, avg_membership_price')
    .not('pushpress_api_key', 'is', null)

  if (accountsError) {
    console.error('[run-agents] Failed to fetch accounts:', accountsError.message)
    return NextResponse.json({ error: accountsError.message }, { status: 500 })
  }

  const claude = { evaluate: makeClaudeEvaluate() }
  let accountsAnalyzed = 0
  let totalInsights = 0
  let totalTasksCreated = 0

  for (const account of accounts ?? []) {
    try {
      // Decrypt API key
      let apiKey: string
      try {
        apiKey = decrypt(account.pushpress_api_key)
      } catch (err) {
        console.error(`[run-agents] Could not decrypt API key for account ${account.id}:`, err)
        continue
      }

      // Build snapshot via connector layer
      let snapshot: AccountSnapshot
      try {
        snapshot = await buildAccountSnapshot(
          account.id,
          account.gym_name ?? 'Business',
          apiKey,
          account.pushpress_company_id ?? undefined,
          account.avg_membership_price ?? undefined,
        )
      } catch (err) {
        console.error(`[run-agents] Connector fetch failed for account ${account.id}:`, err)
        continue
      }

      // Fetch cron automations due now, joined with agent capability
      const currentUTCHour = new Date().getUTCHours()
      const { data: automationsRaw } = await supabaseAdmin
        .from('agent_automations')
        .select('id, cron_schedule, run_hour, agent_id, agents!inner(id, skill_type, system_prompt, name)')
        .eq('account_id', account.id)
        .eq('trigger_type', 'cron')
        .eq('is_active', true)

      // Hourly automations always run; daily/weekly only at their scheduled hour
      const dueAutomations = (automationsRaw ?? []).filter((a: any) => {
        if (a.cron_schedule === 'hourly') return true
        const agentHour = a.run_hour ?? 9
        if (a.cron_schedule === 'daily') return currentUTCHour === agentHour
        if (a.cron_schedule === 'weekly') {
          const now = new Date()
          return now.getUTCDay() === 1 && currentUTCHour === agentHour
        }
        return true
      })

      // Extract agent objects from the join
      const agents = dueAutomations.map((a: any) => ({
        ...(a.agents as any),
        automationId: a.id,
      }))

      if (agents.length === 0) {
        console.log(`[run-agents] No agents due for account ${account.id} at UTC hour ${currentUTCHour}, skipping`)
        continue
      }

      // Run each agent through the generic runtime
      const allInsights: AccountInsight[] = []
      const agentResults: { agentId: string; name: string; count: number }[] = []

      for (const agent of agents) {
        try {
          const result = await runAgentAnalysis(
            {
              skillType: agent.skill_type,
              systemPromptOverride: agent.system_prompt,
              accountId: account.id,
            },
            snapshot,
            claude,
          )

          // Create tasks from this agent's insights
          let tasksCreated = 0
          for (const insight of result.insights) {
            try {
              await createInsightTask({ accountId: account.id, insight })
              tasksCreated++
            } catch (err) {
              console.error(`[run-agents] Failed to create task:`, (err as Error).message)
            }
          }

          allInsights.push(...result.insights)
          agentResults.push({ agentId: agent.id, name: agent.name ?? agent.skill_type, count: result.insights.length })
          totalTasksCreated += tasksCreated

          // Record this agent run
          await supabaseAdmin
            .from('agent_runs')
            .insert({
              account_id: account.id,
              agent_id: agent.id,
              agent_type: agent.skill_type,
              automation_id: agent.automationId ?? null,
              trigger_source: 'cron',
              trigger_ref: agent.automationId ? 'scheduled' : null,
              status: 'completed',
              input_summary: `Cron: ${result.insights.length} insights from ${snapshot.members.length} members`,
              output: { insightCount: result.insights.length, tasksCreated },
            })

          console.log(`[run-agents] agent=${agent.name ?? agent.skill_type} insights=${result.insights.length} tasks=${tasksCreated}`)
        } catch (err) {
          console.error(`[run-agents] Agent ${agent.skill_type} failed for account ${account.id}:`, err)
          // Continue to next agent
        }
      }

      // Save KPI snapshot (aggregated across all agents)
      const activeMembers = snapshot.members.filter(m => m.status === 'active').length
      const churnRiskCount = allInsights.filter(
        i => i.priority === 'critical' || i.priority === 'high'
      ).length
      const revenueMtd = snapshot.members
        .filter(m => m.status === 'active')
        .reduce((sum, m) => sum + m.monthlyRevenue, 0)

      await saveKPISnapshot(account.id, {
        activeMembers,
        churnRiskCount,
        revenueMtd,
        insightsGenerated: allInsights.length,
        rawData: {
          snapshotCapturedAt: snapshot.capturedAt,
          totalMembers: snapshot.members.length,
          agentResults,
        },
      })

      // Build system event summary showing which agents found what
      const agentSummary = agentResults
        .filter(a => a.count > 0)
        .map(a => `${a.name}: ${a.count}`)
        .join(', ')
      const eventMsg = allInsights.length > 0
        ? `Agents found ${allInsights.length} insight${allInsights.length !== 1 ? 's' : ''} (${agentSummary}), added to your To-Do.`
        : 'Agents ran analysis — no issues found.'
      await appendSystemEvent(account.id, eventMsg)

      // Generate artifact (fire-and-forget)
      if (allInsights.length > 0) {
        generateAnalysisArtifact(
          account.id,
          account.gym_name ?? 'Your Business',
          { insights: allInsights, insightsFound: allInsights.length, tasksCreated: totalTasksCreated },
          snapshot,
        ).catch(err => {
          console.warn(`[run-agents] Artifact generation failed for account ${account.id}:`, (err as Error).message)
        })
      }

      accountsAnalyzed++
      totalInsights += allInsights.length

      console.log(`[run-agents] account=${account.id} agents=${agents.length} insights=${allInsights.length}`)
    } catch (err) {
      console.error(`[run-agents] Unexpected error for account ${account.id}:`, err)
    }
  }

  console.log(`[run-agents] Done. accounts=${accountsAnalyzed} insights=${totalInsights} tasks=${totalTasksCreated}`)

  return NextResponse.json({
    ok: true,
    accountsAnalyzed,
    totalInsights,
    totalTasksCreated,
  })
}

// ── Artifact generation ──────────────────────────────────────────────────────

async function generateAnalysisArtifact(
  accountId: string,
  accountName: string,
  result: { insights: AccountInsight[]; insightsFound: number; tasksCreated: number },
  snapshot: AccountSnapshot,
) {
  const now = new Date()
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  let roi = { membersRetained: 0, revenueRetained: 0, messagesSent: 0, conversationsActive: 0, escalations: 0 }
  try {
    roi = await getMonthlyRetentionROI(accountId)
  } catch {
    // Non-fatal
  }

  const priorityToRisk = (p: string): 'high' | 'medium' | 'low' =>
    p === 'critical' || p === 'high' ? 'high' : p === 'medium' ? 'medium' : 'low'

  const priorityToStatus = (p: string): 'at_risk' | 'escalated' | 'active' =>
    p === 'critical' ? 'escalated' : p === 'high' || p === 'medium' ? 'at_risk' : 'active'

  const artifactData: ResearchSummaryData = {
    accountName,
    generatedAt: now.toISOString(),
    period: monthLabel,
    generatedBy: 'Agents',
    stats: {
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
      status: priorityToStatus(insight.priority),
      riskLevel: priorityToRisk(insight.priority),
      detail: insight.detail ?? insight.title,
      membershipValue: undefined,
    })),
    insights: [
      ...result.insights.length > 0
        ? [`${result.insightsFound} members flagged across ${new Set(result.insights.map(i => i.type)).size} categories`]
        : [],
      ...(result.insights.filter(i => i.priority === 'critical').length > 0
        ? [`${result.insights.filter(i => i.priority === 'critical').length} critical priority — review these first`]
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

  console.log(`[run-agents] Artifact generated for account ${accountId}`)
}

// Vercel Cron Jobs send GET requests — also keep POST for manual triggers
export const GET = handler
export const POST = handler
