import { NextRequest, NextResponse } from 'next/server'
import { getSession, getTier } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

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
      .from('autopilots')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .not('demo_session_id', 'is', null)
      .then(() => {})

    // Get this session's autopilots (non-expired)
    const { data: autopilots } = await supabaseAdmin
      .from('autopilots')
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
        gym_name: 'Iron & Grit CrossFit',
        member_count: 247,
        pushpress_company_id: process.env.PUSHPRESS_COMPANY_ID,
      },
      tier: 'pro',
      autopilots: autopilots || [],
      recentRuns: [],
      pendingActions,
      monthlyRunCount: 14,
      recentEvents: [],
      isDemo: true,
    })
  }
  
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
  
  const tier = getTier(user)
  
  // Get autopilots (v2: includes trigger fields)
  let autopilots: any[] = []
  if (gym) {
    const { data } = await supabaseAdmin
      .from('autopilots')
      .select('*')
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: true })
    autopilots = data || []
  }
  
  // Get recent runs
  let recentRuns: any[] = []
  if (gym) {
    const { data } = await supabaseAdmin
      .from('agent_runs')
      .select('*')
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(5)
    recentRuns = data || []
  }
  
  // Get pending actions (not approved/dismissed)
  let pendingActions: any[] = []
  if (gym && recentRuns.length > 0) {
    const runIds = recentRuns.map(r => r.id)
    const { data } = await supabaseAdmin
      .from('agent_actions')
      .select('*')
      .in('agent_run_id', runIds)
      .is('approved', null)
      .is('dismissed', null)
      .order('created_at', { ascending: false })
    pendingActions = data || []
  }
  
  // Get monthly run count
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  
  let monthlyRunCount = 0
  if (gym) {
    const { count } = await supabaseAdmin
      .from('agent_runs')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('created_at', startOfMonth.toISOString())
    monthlyRunCount = count || 0
  }

  // Get recent webhook events (last 10)
  let recentEvents: any[] = []
  if (gym) {
    const { data } = await supabaseAdmin
      .from('webhook_events')
      .select('id, event_type, created_at, agent_runs_triggered, processed_at')
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(10)
    recentEvents = data || []
  }
  
  return NextResponse.json({
    user,
    gym,
    tier,
    autopilots,
    recentRuns,
    pendingActions,
    monthlyRunCount,
    recentEvents,
    isDemo: false,
  })
}
