export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccountForUser } from '@/lib/db/accounts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeNextRun(agent: { trigger_mode?: string; cron_schedule?: string; run_hour?: number }): string | null {
  if (agent.trigger_mode !== 'cron') return null
  const now = new Date()
  const hour = agent.run_hour ?? 9

  if (!agent.cron_schedule || agent.cron_schedule === 'daily') {
    const next = new Date()
    next.setHours(hour, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  if (agent.cron_schedule === 'hourly') {
    const next = new Date(now)
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next.toISOString()
  }
  if (agent.cron_schedule === 'weekly') {
    const next = new Date()
    next.setHours(hour, 0, 0, 0)
    const daysUntilMonday = (8 - next.getDay()) % 7 || 7
    if (next <= now) next.setDate(next.getDate() + daysUntilMonday)
    return next.toISOString()
  }
  return null
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Demo session: return scoped, session-isolated data
  if ((session as any).isDemo) {
    const sessionId = (session as any).demoSessionId
    const visitorName: string = (session as any).demoVisitorName || ''
    const visitorEmail: string = (session as any).demoVisitorEmail || ''
    const firstName = visitorName ? visitorName.split(' ')[0] : visitorName

    // Silently clean up expired demo agents (fire and forget)
    supabaseAdmin
      .from('agents')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .not('demo_session_id', 'is', null)
      .then(() => {})

    // Get this session's agents (non-expired)
    const { data: agents } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('demo_session_id', sessionId)
      .gt('expires_at', new Date().toISOString())

    // Build personalised pending actions — visitor is ALWAYS first if we have their details
    const visitorCard = visitorName ? {
      id: 'demo-visitor-card',
      approved: null,
      dismissed: null,
      content: {
        memberId: 'demo-visitor',
        memberName: visitorName,
        memberEmail: visitorEmail,
        riskLevel: 'high' as const,
        riskReason: '19 days since last visit — longest gap in 14 months',
        recommendedAction: 'Personal check-in message',
        draftedMessage: `Hey ${firstName}! Coach Marcus here. Haven't seen you in a few weeks and wanted to check in — everything good? We miss having you in class. If anything's going on or you need to adjust your schedule, just say the word.`,
        messageSubject: 'Checking in on you',
        confidence: 91,
        insights: `${visitorName} used to come in 4x a week. Last visit was 19 days ago — the longest gap since joining 14 months ago. No vacation hold or note on file.`,
        playbookName: 'At-Risk Monitor',
      },
    } : null

    const pendingActions = [
      ...(visitorCard ? [visitorCard] : []),
      {
        id: 'demo-action-derek',
        approved: null,
        dismissed: null,
        content: {
          memberId: 'demo-derek',
          memberName: 'Derek Walsh',
          memberEmail: 'derek@example.com',
          riskLevel: 'high' as const,
          riskReason: 'Dropped from 5x to 1x/week — renewal in 12 days',
          recommendedAction: 'Re-engagement before renewal',
          draftedMessage: "Hey Derek, Coach Marcus. Noticed you've had a lighter month — totally normal, life gets busy. Your membership renews soon and I want to make sure you're getting value from it. Want to jump on a quick call or come in for a free personal session this week? On me.",
          messageSubject: "Let's get you back on track",
          confidence: 87,
          insights: 'Renewal in 12 days. Drop from 5x to 1x/week in past 3 weeks.',
          playbookName: 'Renewal At-Risk',
        },
      },
      {
        id: 'demo-action-priya',
        approved: null,
        dismissed: null,
        content: {
          memberId: 'demo-priya',
          memberName: 'Priya Patel',
          memberEmail: 'priya@example.com',
          riskLevel: 'medium' as const,
          riskReason: 'Down from 3x to 1x/week for a month',
          recommendedAction: 'Friendly encouragement',
          draftedMessage: "Hey Priya! We've loved watching your progress over the past 6 months. Noticed you've had a quieter month — hope you're doing well! If you want to ease back in or try a different class time, I'm happy to help find what works for you.",
          messageSubject: "How's it going?",
          confidence: 74,
          insights: 'Down from 3x/week to ~1x/week for 4 weeks.',
          playbookName: 'At-Risk Monitor',
        },
      },
    ]

    return NextResponse.json({
      user: { id: `demo-${sessionId}`, email: 'demo@gymagents.com' },
      gym: {
        id: 'demo-gym',
        account_name: 'PushPress East',
        member_count: 127,
        pushpress_company_id: process.env.PUSHPRESS_COMPANY_ID,
      },
      tier: 'pro',
      agents: agents || [],
      recentRuns: [],
      pendingActions,
      monthlyRunCount: 14,
      recentEvents: [],
      stats: {
        activeAgents: (agents || []).filter((a: any) => a.is_active).length,
        pendingCount: pendingActions.length,
        lastRunAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      isDemo: true,
    })
  }
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', session.id)
    .single()
  
  const account = await getAccountForUser(session.id)

  const tier = getTier(user)

  // Get agents + their automations for this account
  let agents: any[] = []
  if (account) {
    const { data } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })

    // Fetch automations and merge into agent objects for backward-compatible response
    const { data: automations } = await supabaseAdmin
      .from('agent_automations')
      .select('*')
      .eq('account_id', account.id)

    const autoMap = new Map<string, any[]>()
    for (const a of automations ?? []) {
      const list = autoMap.get(a.agent_id) ?? []
      list.push(a)
      autoMap.set(a.agent_id, list)
    }

    agents = (data || []).map((agent: any) => {
      const agentAutos = autoMap.get(agent.id) ?? []
      const cronAuto = agentAutos.find((a: any) => a.trigger_type === 'cron')
      const eventAuto = agentAutos.find((a: any) => a.trigger_type === 'event')
      const merged = {
        ...agent,
        automations: agentAutos,
        cron_schedule: cronAuto?.cron_schedule ?? agent.cron_schedule,
        run_hour: cronAuto?.run_hour ?? agent.run_hour,
        trigger_event: eventAuto?.event_type ?? agent.trigger_event,
      }
      return {
        ...merged,
        next_run_at: computeNextRun(merged),
      }
    })
  }

  // Get recent runs
  let recentRuns: any[] = []
  if (account) {
    const { data } = await supabaseAdmin
      .from('agent_runs')
      .select('*')
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })
      .limit(5)
    recentRuns = data || []
  }
  
  // Get pending actions from agent_tasks
  let pendingActions: any[] = []
  if (account) {
    const { data: tasks } = await supabaseAdmin
      .from('agent_tasks')
      .select('*')
      .eq('account_id', account.id)
      .in('status', ['open', 'awaiting_approval', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(20)

    if (tasks && tasks.length > 0) {
      pendingActions = tasks.map((t: {
        id: string
        status: string
        assigned_agent?: string
        task_type?: string
        goal?: string
        priority?: string
        context?: Record<string, unknown>
        member_name?: string
        member_email?: string
        member_id?: string
        insight_member_name?: string
        insight_member_email?: string
        insight_member_id?: string
        insight_risk_level?: string
        insight_reason?: string
        insight_recommended_action?: string
        insight_draft_message?: string
        insight_message_subject?: string
        insight_confidence?: number
        insight_detail?: string
        insight_playbook_name?: string
        insight_estimated_impact?: string
        created_at: string
      }) => {
        const ctx = (t.context ?? {}) as Record<string, unknown>
        return {
          id: t.id,
          assignedAgent: t.assigned_agent ?? 'gm',
          taskType: t.task_type ?? 'ad_hoc',
          goal: t.goal ?? '',
          priority: (t.priority ?? ctx.priority ?? 'medium') as 'critical' | 'high' | 'medium' | 'low',
          approved: null,
          dismissed: null,
          content: {
            memberId: t.insight_member_id ?? ctx.memberId ?? t.id,
            memberName: t.insight_member_name ?? t.member_name ?? ctx.memberName ?? 'Member',
            memberEmail: t.insight_member_email ?? t.member_email ?? ctx.memberEmail ?? '',
            riskLevel: (t.insight_risk_level ?? ctx.riskLevel ?? 'medium') as 'high' | 'medium' | 'low',
            riskReason: t.insight_reason ?? ctx.riskReason ?? '',
            recommendedAction: t.insight_recommended_action ?? ctx.recommendedAction ?? '',
            draftedMessage: t.insight_draft_message ?? ctx.draftMessage ?? '',
            messageSubject: t.insight_message_subject ?? ctx.messageSubject ?? '',
            confidence: t.insight_confidence ?? ctx.confidence ?? 0.75,
            insights: t.insight_detail ?? ctx.insightDetail ?? '',
            playbookName: t.insight_playbook_name ?? ctx.playbookName ?? undefined,
            estimatedImpact: t.insight_estimated_impact ?? ctx.estimatedImpact ?? '',
          },
        }
      })
    }
  }
  
  // Annotate agents with pending task counts
  if (pendingActions.length > 0) {
    const countByAgent = new Map<string, number>()
    for (const action of pendingActions) {
      const key = action.assignedAgent ?? 'gm'
      countByAgent.set(key, (countByAgent.get(key) ?? 0) + 1)
    }
    agents = agents.map((agent: any) => ({
      ...agent,
      pending_count: countByAgent.get(agent.id) ?? countByAgent.get(agent.skill_type) ?? 0,
    }))
  }

  // Get monthly run count
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  
  let monthlyRunCount = 0
  if (account) {
    const { count } = await supabaseAdmin
      .from('agent_runs')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', account.id)
      .gte('created_at', startOfMonth.toISOString())
    monthlyRunCount = count || 0
  }

  // Get recent webhook events (last 10)
  let recentEvents: any[] = []
  if (account) {
    const { data } = await supabaseAdmin
      .from('webhook_events')
      .select('id, event_type, created_at, agent_runs_triggered, processed_at')
      .eq('account_id', account.id)
      .order('created_at', { ascending: false })
      .limit(10)
    recentEvents = data || []
  }
  
  const stats = {
    activeAgents: agents.filter((a: any) => a.is_active).length,
    pendingCount: pendingActions.length,
    lastRunAt: recentRuns[0]?.created_at ?? null,
  }

  return NextResponse.json({
    user,
    account,
    tier,
    agents,
    recentRuns,
    pendingActions,
    monthlyRunCount,
    recentEvents,
    stats,
    isDemo: false,
  })
}
