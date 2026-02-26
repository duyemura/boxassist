import { NextRequest } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { createPushPressClient, getAtRiskMembers } from '@/lib/pushpress'
import { runAtRiskDetector } from '@/lib/claude'
import { decrypt } from '@/lib/encrypt'
import { calcCost, calcTimeSaved } from '@/lib/cost'
import { createTask } from '@/lib/db/tasks'

// ── SSE helpers ───────────────────────────────────────────────────────────────

const enc = new TextEncoder()

type SSEEvent =
  | { type: 'status'; text: string }
  | { type: 'done'; result: Record<string, unknown> }
  | { type: 'error'; message: string }

function sseChunk(event: SSEEvent): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(event)}\n\n`)
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
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

          emit({ type: 'status', text: 'Connecting to PushPress…' })

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

          emit({ type: 'status', text: `Found ${atRiskMembers.length} members to review — running analysis…` })

          const agentOutput = await runAtRiskDetector(demoGymName, atRiskMembers, 'pro')

          emit({ type: 'status', text: `Analysis complete — ${agentOutput.actions.length} members flagged` })

          if (demoSessionId) {
            const { data: currentAutopilot } = await supabaseAdmin
              .from('autopilots')
              .select('run_count, id')
              .eq('demo_session_id', demoSessionId)
              .eq('skill_type', 'at_risk_detector')
              .gt('expires_at', new Date().toISOString())
              .single()
            if (currentAutopilot) {
              await supabaseAdmin
                .from('autopilots')
                .update({ last_run_at: new Date().toISOString(), run_count: (currentAutopilot.run_count || 0) + 1 })
                .eq('id', currentAutopilot.id)
            }
          }

          emit({
            type: 'done',
            result: { success: true, runId: `demo-run-${demoSessionId || 'anon'}`, output: agentOutput, tier: 'pro', isDemo: true },
          })
          controller.close()
          return
        }

        // ── Real gym path ──────────────────────────────────────────────────
        emit({ type: 'status', text: 'Checking credentials…' })

        const { data: user } = await supabaseAdmin
          .from('users').select('*').eq('id', session.id).single()

        const { data: gym } = await supabaseAdmin
          .from('gyms').select('*').eq('user_id', session.id).single()

        if (!gym) {
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
            .eq('gym_id', gym.id).gte('created_at', startOfMonth.toISOString())
          if ((count || 0) >= 3) {
            emit({ type: 'error', message: "Monthly scan limit reached. Upgrade to run more scans." })
            controller.close()
            return
          }
        }

        emit({ type: 'status', text: 'Fetching member check-in data from PushPress…' })

        const apiKey = decrypt(gym.pushpress_api_key)
        const client = createPushPressClient(apiKey, gym.pushpress_company_id)

        const { data: run } = await supabaseAdmin
          .from('agent_runs')
          .insert({ gym_id: gym.id, agent_type: 'at_risk_detector', status: 'running', input_summary: `Scanning ${gym.member_count} members for churn risk` })
          .select().single()

        let atRiskMembers = await getAtRiskMembers(client, gym.pushpress_company_id)

        if (atRiskMembers.length === 0) {
          const now = new Date()
          atRiskMembers = [
            { id: 'demo-1', name: 'Sarah Johnson', email: 'sarah@example.com', lastCheckin: new Date(now.getTime() - 18 * 86_400_000), daysSinceCheckin: 18, averageWeeklyCheckins: 3.2, membershipType: 'Unlimited Monthly', memberSince: new Date(now.getTime() - 280 * 86_400_000), riskScore: 75 },
            { id: 'demo-2', name: 'Mike Torres', email: 'mike@example.com', lastCheckin: new Date(now.getTime() - 25 * 86_400_000), daysSinceCheckin: 25, averageWeeklyCheckins: 2.1, membershipType: 'Monthly', memberSince: new Date(now.getTime() - 95 * 86_400_000), riskScore: 85 },
            { id: 'demo-3', name: 'Emma Walsh', email: 'emma@example.com', lastCheckin: new Date(now.getTime() - 16 * 86_400_000), daysSinceCheckin: 16, averageWeeklyCheckins: 4.5, membershipType: 'Unlimited Monthly', memberSince: new Date(now.getTime() - 450 * 86_400_000), riskScore: 60 },
          ]
        }

        const membersForAnalysis = tier === 'free' ? atRiskMembers.slice(0, 5) : atRiskMembers

        emit({ type: 'status', text: `Found ${membersForAnalysis.length} members to analyze — running churn risk scoring…` })

        const agentOutput = await runAtRiskDetector(gym.gym_name, membersForAnalysis, tier)

        emit({ type: 'status', text: `Analysis complete — ${agentOutput.actions.length} members flagged. Saving tasks…` })

        for (const action of agentOutput.actions) {
          try {
            await createTask({
              gymId: gym.id,
              assignedAgent: 'retention',
              taskType: 'churn_risk',
              memberEmail: action.memberEmail ?? undefined,
              memberName: action.memberName ?? undefined,
              goal: action.recommendedAction ?? 'Re-engage member',
              context: {
                memberId: action.memberId,
                riskLevel: action.riskLevel,
                riskReason: action.riskReason,
                recommendedAction: action.recommendedAction,
                draftMessage: action.draftedMessage,
                messageSubject: action.messageSubject,
                confidence: action.confidence,
                insightDetail: action.insights,
                playbookName: action.playbookName,
                estimatedImpact: action.estimatedImpact,
                runId: run!.id,
              },
              requiresApproval: true,
            })
          } catch (err: any) {
            console.error('Failed to create agent_task:', err?.message)
          }
        }

        // Cost tracking
        const usage = agentOutput._usage ?? { input_tokens: 0, output_tokens: 0 }
        const { costUsd, markupUsd, billedUsd } = calcCost(usage.input_tokens, usage.output_tokens)
        const messagesSent = agentOutput.actions.length
        const timeSavedMinutes = calcTimeSaved(messagesSent)

        await supabaseAdmin.from('agent_runs').update({
          status: 'completed',
          output: agentOutput,
          input_summary: `Found ${agentOutput.totalAtRisk} at-risk members out of ${gym.member_count} total`,
          members_scanned: gym.member_count,
          actions_taken: agentOutput.actions.length,
          messages_sent: messagesSent,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cost_usd: costUsd,
          markup_usd: markupUsd,
          billed_usd: billedUsd,
          api_key_source: 'gymagents',
          time_saved_minutes: timeSavedMinutes,
          outcome_status: 'pending',
          triggered_by: 'manual',
          completed_at: new Date().toISOString(),
        }).eq('id', run!.id)

        const { data: currentAutopilot } = await supabaseAdmin
          .from('autopilots').select('run_count').eq('gym_id', gym.id).eq('skill_type', 'at_risk_detector').single()
        await supabaseAdmin.from('autopilots').update({
          last_run_at: new Date().toISOString(),
          run_count: (currentAutopilot?.run_count || 0) + 1,
        }).eq('gym_id', gym.id).eq('skill_type', 'at_risk_detector')

        emit({ type: 'done', result: { success: true, runId: run!.id, output: agentOutput, tier } })
        controller.close()

      } catch (error: any) {
        console.error('Autopilot run error:', error)
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
