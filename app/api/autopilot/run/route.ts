import { NextRequest, NextResponse } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { createPushPressClient, getAtRiskMembers } from '@/lib/pushpress'
import { runAtRiskDetector } from '@/lib/claude'
import { decrypt } from '@/lib/encrypt'
import { calcCost, calcTimeSaved } from '@/lib/cost'
import { createTask } from '@/lib/db/tasks'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  try {
    // Demo session: use env var credentials, scope run to this session
    if ((session as any).isDemo) {
      const demoSessionId = (session as any).demoSessionId
      const demoApiKey = process.env.PUSHPRESS_API_KEY!
      const demoCompanyId = process.env.PUSHPRESS_COMPANY_ID!
      const demoGymName = 'PushPress East'
      const client = createPushPressClient(demoApiKey, demoCompanyId)

      let atRiskMembers = await getAtRiskMembers(client, demoCompanyId)
      if (atRiskMembers.length === 0) {
        const now = new Date()
        atRiskMembers = [
          {
            id: 'demo-1', name: 'Sarah Johnson', email: 'sarah@example.com',
            lastCheckin: new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000),
            daysSinceCheckin: 18, averageWeeklyCheckins: 3.2,
            membershipType: 'Unlimited Monthly',
            memberSince: new Date(now.getTime() - 280 * 24 * 60 * 60 * 1000), riskScore: 75
          },
          {
            id: 'demo-2', name: 'Mike Torres', email: 'mike@example.com',
            lastCheckin: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
            daysSinceCheckin: 25, averageWeeklyCheckins: 2.1,
            membershipType: 'Monthly',
            memberSince: new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000), riskScore: 85
          },
          {
            id: 'demo-3', name: 'Emma Walsh', email: 'emma@example.com',
            lastCheckin: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000),
            daysSinceCheckin: 16, averageWeeklyCheckins: 4.5,
            membershipType: 'Unlimited Monthly',
            memberSince: new Date(now.getTime() - 450 * 24 * 60 * 60 * 1000), riskScore: 60
          }
        ]
      }

      const agentOutput = await runAtRiskDetector(demoGymName, atRiskMembers, 'pro')

      // Update autopilot run stats scoped to this demo session
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
            .update({
              last_run_at: new Date().toISOString(),
              run_count: (currentAutopilot.run_count || 0) + 1
            })
            .eq('id', currentAutopilot.id)
        }
      }

      return NextResponse.json({
        success: true,
        runId: `demo-run-${demoSessionId || 'anon'}`,
        output: agentOutput,
        tier: 'pro',
        isDemo: true,
      })
    }

    // Get user and gym
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', session.id)
      .single()
    
    const { data: gym } = await supabaseAdmin
      .from('gyms')
      .select('*')
      .eq('user_id', session.id)
      .single()
    
    if (!gym) {
      return NextResponse.json({ error: 'No gym connected' }, { status: 400 })
    }
    
    const tier = getTier(user)
    
    // Check run limits for free tier
    if (tier === 'free') {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      
      const { count } = await supabaseAdmin
        .from('agent_runs')
        .select('*', { count: 'exact', head: true })
        .eq('gym_id', gym.id)
        .gte('created_at', startOfMonth.toISOString())
      
      if ((count || 0) >= 3) {
        return NextResponse.json({ 
          error: 'Monthly limit reached',
          upgradeRequired: true,
          message: "You've used your 3 free scans this month. Upgrade to Starter to run daily scans."
        }, { status: 403 })
      }
    }
    
    // Fetch PushPress data
    const apiKey = decrypt(gym.pushpress_api_key)
    const client = createPushPressClient(apiKey, gym.pushpress_company_id)
    
    // Create run record
    const { data: run } = await supabaseAdmin
      .from('agent_runs')
      .insert({
        gym_id: gym.id,
        agent_type: 'at_risk_detector',
        status: 'running',
        input_summary: `Scanning ${gym.member_count} members for churn risk`
      })
      .select()
      .single()
    
    // Get at-risk members from PushPress
    let atRiskMembers = await getAtRiskMembers(client, gym.pushpress_company_id)
    
    // For demo/testing: if no real data, generate sample data
    if (atRiskMembers.length === 0) {
      const now = new Date()
      atRiskMembers = [
        {
          id: 'demo-1',
          name: 'Sarah Johnson',
          email: 'sarah@example.com',
          lastCheckin: new Date(now.getTime() - 18 * 24 * 60 * 60 * 1000),
          daysSinceCheckin: 18,
          averageWeeklyCheckins: 3.2,
          membershipType: 'Unlimited Monthly',
          memberSince: new Date(now.getTime() - 280 * 24 * 60 * 60 * 1000),
          riskScore: 75
        },
        {
          id: 'demo-2',
          name: 'Mike Torres',
          email: 'mike@example.com',
          lastCheckin: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
          daysSinceCheckin: 25,
          averageWeeklyCheckins: 2.1,
          membershipType: 'Monthly',
          memberSince: new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000),
          riskScore: 85
        },
        {
          id: 'demo-3',
          name: 'Emma Walsh',
          email: 'emma@example.com',
          lastCheckin: new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000),
          daysSinceCheckin: 16,
          averageWeeklyCheckins: 4.5,
          membershipType: 'Unlimited Monthly',
          memberSince: new Date(now.getTime() - 450 * 24 * 60 * 60 * 1000),
          riskScore: 60
        }
      ]
    }
    
    // Limit for free tier
    const membersForAnalysis = tier === 'free' ? atRiskMembers.slice(0, 5) : atRiskMembers
    
    // Run Claude analysis
    const agentOutput = await runAtRiskDetector(gym.gym_name, membersForAnalysis, tier)
    
    // Store actions as agent_tasks
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

    // ── Cost tracking ──────────────────────────────────────────────────────
    const usage = agentOutput._usage ?? { input_tokens: 0, output_tokens: 0 }
    const { costUsd, markupUsd, billedUsd } = calcCost(
      usage.input_tokens,
      usage.output_tokens
    )
    const messagesSent = agentOutput.actions.length
    const timeSavedMinutes = calcTimeSaved(messagesSent)

    // Update run record with cost data
    await supabaseAdmin
      .from('agent_runs')
      .update({
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
      })
      .eq('id', run!.id)
    // ──────────────────────────────────────────────────────────────────────

    // Update autopilot stats
    const { data: currentAutopilot } = await supabaseAdmin
      .from('autopilots')
      .select('run_count')
      .eq('gym_id', gym.id)
      .eq('skill_type', 'at_risk_detector')
      .single()
    
    await supabaseAdmin
      .from('autopilots')
      .update({
        last_run_at: new Date().toISOString(),
        run_count: (currentAutopilot?.run_count || 0) + 1
      })
      .eq('gym_id', gym.id)
      .eq('skill_type', 'at_risk_detector')
    
    return NextResponse.json({
      success: true,
      runId: run!.id,
      output: agentOutput,
      tier
    })
  } catch (error: any) {
    console.error('Autopilot run error:', error)
    return NextResponse.json({ error: error.message || 'Autopilot run failed' }, { status: 500 })
  }
}
