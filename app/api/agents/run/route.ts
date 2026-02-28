export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'
import { createPushPressClient, getAtRiskMembers } from '@/lib/pushpress'
import { runAtRiskDetector } from '@/lib/claude'
import { decrypt } from '@/lib/encrypt'
import { calcCost, calcTimeSaved } from '@/lib/cost'
import { createInsightTask } from '@/lib/db/tasks'
import { runAgentAnalysis } from '@/lib/agents/agent-runtime'
import { buildAccountSnapshot } from '@/lib/pushpress-platform'
import { harvestDataLenses } from '@/lib/data-lens'
import type { AccountInsight, AccountSnapshot } from '@/lib/agents/GMAgent'
import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from '@/lib/models'

// ── SSE helpers ───────────────────────────────────────────────────────────────

const enc = new TextEncoder()

type SSEEvent =
  | { type: 'status'; text: string }
  | { type: 'done'; result: Record<string, unknown> }
  | { type: 'error'; message: string }

function sseChunk(event: SSEEvent): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(event)}\n\n`)
}

// ── Claude evaluate helper ──────────────────────────────────────────────────

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

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let session: Awaited<ReturnType<typeof getSession>>
  try {
    session = await getSession()
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Auth error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SSEEvent) => controller.enqueue(sseChunk(event))

      try {
        // ── Demo path ──────────────────────────────────────────────────────
        if ((session as any).isDemo) {
          const demoSessionId = (session as any).demoSessionId
          const demoApiKey = process.env.PUSHPRESS_API_KEY!
          const demoCompanyId = process.env.PUSHPRESS_COMPANY_ID!
          const demoGymName = 'PushPress East'
          const client = createPushPressClient(demoApiKey, demoCompanyId)

          emit({ type: 'status', text: 'Connecting to PushPress\u2026' })

          let atRiskMembers = await getAtRiskMembers(client, demoCompanyId)
          if (atRiskMembers.length === 0) {
            const now = new Date()
            atRiskMembers = [
              {
                id: 'demo-1', name: 'Sarah Johnson', email: 'sarah@example.com',
                lastCheckin: new Date(now.getTime() - 18 * 86_400_000),
                daysSinceCheckin: 18, averageWeeklyCheckins: 3.2,
                membershipType: 'Unlimited Monthly',
                memberSince: new Date(now.getTime() - 280 * 86_400_000), riskScore: 75,
              },
              {
                id: 'demo-2', name: 'Mike Torres', email: 'mike@example.com',
                lastCheckin: new Date(now.getTime() - 25 * 86_400_000),
                daysSinceCheckin: 25, averageWeeklyCheckins: 2.1,
                membershipType: 'Monthly',
                memberSince: new Date(now.getTime() - 95 * 86_400_000), riskScore: 85,
              },
              {
                id: 'demo-3', name: 'Emma Walsh', email: 'emma@example.com',
                lastCheckin: new Date(now.getTime() - 16 * 86_400_000),
                daysSinceCheckin: 16, averageWeeklyCheckins: 4.5,
                membershipType: 'Unlimited Monthly',
                memberSince: new Date(now.getTime() - 450 * 86_400_000), riskScore: 60,
              },
            ]
          }

          emit({ type: 'status', text: `Found ${atRiskMembers.length} members to review \u2014 running analysis\u2026` })

          const agentOutput = await runAtRiskDetector(demoGymName, atRiskMembers, 'pro')

          emit({ type: 'status', text: `Analysis complete \u2014 ${agentOutput.actions.length} members flagged` })

          emit({
            type: 'done',
            result: { success: true, runId: `demo-run-${demoSessionId || 'anon'}`, output: agentOutput, tier: 'pro', isDemo: true },
          })
          controller.close()
          return
        }

        // ── Real account path ────────────────────────────────────────────
        emit({ type: 'status', text: 'Checking credentials\u2026' })

        const { data: user } = await supabaseAdmin
          .from('users').select('*').eq('id', session.id).single()

        const account = await getAccountForUser(session.id)

        if (!account) {
          emit({ type: 'error', message: 'No gym connected' })
          controller.close()
          return
        }

        const tier = getTier(user)

        // Free tier run limit check
        if (tier === 'free') {
          const startOfMonth = new Date()
          startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)
          const { count } = await supabaseAdmin
            .from('agent_runs').select('*', { count: 'exact', head: true })
            .eq('account_id', account.id).gte('created_at', startOfMonth.toISOString())
          if ((count || 0) >= 3) {
            emit({ type: 'error', message: "Monthly scan limit reached. Upgrade to run more scans." })
            controller.close()
            return
          }
        }

        emit({ type: 'status', text: 'Fetching member data from PushPress\u2026' })

        const apiKey = decrypt(account.pushpress_api_key as string)
        const accountId = account.id as string
        const accountName = ((account.gym_name ?? account.account_name ?? 'Your Business') as string)

        // Build abstract snapshot via the PushPress connector
        let snapshot: AccountSnapshot
        try {
          snapshot = await buildAccountSnapshot(
            accountId,
            accountName,
            apiKey,
            (account.pushpress_company_id as string) ?? undefined,
          )
        } catch (err: any) {
          emit({ type: 'error', message: `Failed to fetch PushPress data: ${err.message}` })
          controller.close()
          return
        }

        // Harvest data lens memories (segments snapshot into refreshable summaries)
        try {
          await harvestDataLenses(accountId, snapshot)
        } catch (err: any) {
          console.warn('[agents/run] Data lens harvest failed (non-fatal):', err?.message)
        }

        emit({ type: 'status', text: `Loaded ${snapshot.members.length} members \u2014 fetching active agents\u2026` })

        // Fetch active agents for this account
        const { data: agents } = await supabaseAdmin
          .from('agents')
          .select('id, skill_type, system_prompt, name, run_count')
          .eq('account_id', accountId)
          .eq('is_active', true)

        if (!agents || agents.length === 0) {
          emit({ type: 'error', message: 'No active agents configured. Create an agent from the Agents page.' })
          controller.close()
          return
        }

        // Create agent_run record
        const { data: run } = await supabaseAdmin
          .from('agent_runs')
          .insert({
            account_id: accountId,
            agent_type: 'multi_agent',
            trigger_source: 'manual',
            status: 'running',
            input_summary: `Manual scan: ${agents.length} agent(s) analyzing ${snapshot.members.length} members`,
          })
          .select().single()

        // Set up Claude evaluate function (same as cron)
        const claude = { evaluate: makeClaudeEvaluate() }

        // Run each active agent through the generic runtime
        const allInsights: AccountInsight[] = []
        const agentResults: { agentId: string; name: string; count: number }[] = []

        for (const agent of agents) {
          const agentName = agent.name ?? agent.skill_type
          emit({ type: 'status', text: `Running ${agentName} analysis\u2026` })

          try {
            const result = await runAgentAnalysis(
              {
                skillType: agent.skill_type,
                systemPromptOverride: agent.system_prompt,
                accountId,
              },
              snapshot,
              claude,
            )

            // Create tasks from this agent's insights
            let tasksCreated = 0
            for (const insight of result.insights) {
              try {
                await createInsightTask({ accountId, insight })
                tasksCreated++
              } catch (err: any) {
                console.error('Failed to create agent_task:', err?.message)
              }
            }

            allInsights.push(...result.insights)
            agentResults.push({ agentId: agent.id, name: agentName, count: result.insights.length })

            if (result.insights.length > 0) {
              emit({ type: 'status', text: `${agentName}: ${result.insights.length} insight(s) found` })
            }
          } catch (err: any) {
            console.error(`Agent ${agent.skill_type} failed:`, err)
            // Continue to next agent
          }
        }

        emit({ type: 'status', text: `Analysis complete \u2014 ${allInsights.length} total insight(s) from ${agents.length} agent(s). Saving\u2026` })

        // Cost tracking — estimate based on member count (actual token counts come from the runtime in future)
        const estimatedInputTokens = snapshot.members.length * 200
        const estimatedOutputTokens = allInsights.length * 300
        const { costUsd, markupUsd, billedUsd } = calcCost(estimatedInputTokens, estimatedOutputTokens)
        const messagesSent = allInsights.length
        const timeSavedMinutes = calcTimeSaved(messagesSent)

        // Build output summary compatible with the frontend
        const output = {
          totalAtRisk: allInsights.filter(i => i.priority === 'critical' || i.priority === 'high').length,
          actions: allInsights.map(i => ({
            memberId: i.memberId,
            memberName: i.memberName,
            memberEmail: i.memberEmail,
            riskLevel: i.priority,
            riskReason: i.detail,
            recommendedAction: i.recommendedAction,
            insights: i.detail,
            estimatedImpact: i.estimatedImpact,
            confidence: i.priority === 'critical' ? 0.95 : i.priority === 'high' ? 0.85 : 0.7,
          })),
          agentResults,
          _usage: { input_tokens: estimatedInputTokens, output_tokens: estimatedOutputTokens },
        }

        await supabaseAdmin.from('agent_runs').update({
          status: 'completed',
          output,
          input_summary: `Found ${output.totalAtRisk} high-priority insights out of ${snapshot.members.length} members (${agents.length} agents)`,
          members_scanned: snapshot.members.length,
          actions_taken: allInsights.length,
          messages_sent: messagesSent,
          input_tokens: estimatedInputTokens,
          output_tokens: estimatedOutputTokens,
          cost_usd: costUsd,
          markup_usd: markupUsd,
          billed_usd: billedUsd,
          api_key_source: 'gymagents',
          time_saved_minutes: timeSavedMinutes,
          outcome_status: 'pending',
          triggered_by: 'manual',
          completed_at: new Date().toISOString(),
        }).eq('id', run!.id)

        emit({ type: 'done', result: { success: true, runId: run!.id, output, tier } })
        controller.close()

      } catch (error: any) {
        console.error('Agent run error:', error)
        emit({ type: 'error', message: error.message || 'Analysis failed' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
