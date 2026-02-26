export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET() {
  // Try to read visitor details from the session JWT
  const session = await getSession() as any
  const visitorName: string = session?.demoVisitorName || ''
  const visitorEmail: string = session?.demoVisitorEmail || ''
  const firstName = visitorName ? visitorName.split(' ')[0] : ''

  // Build the first action card — personalised to the visitor when we have their details,
  // otherwise fall back to the static "Sarah Chen" placeholder.
  const firstCard = visitorName && visitorEmail
    ? {
        id: 'demo-action-1',
        approved: null,
        dismissed: null,
        content: {
          memberId: 'demo-visitor',
          memberName: visitorName,
          memberEmail: visitorEmail,
          riskLevel: 'high' as const,
          riskReason: `${visitorName} used to come in 4x a week. They've been quiet for 19 days — longest gap since joining 14 months ago.`,
          recommendedAction: 'Personal check-in message',
          draftedMessage: `Hey ${firstName}! Coach Marcus here. Haven't seen you in a few weeks and wanted to check in — everything good? We miss having you in class. If anything's going on or you need to adjust your schedule, just say the word. 💪`,
          messageSubject: 'Checking in on you',
          confidence: 91,
          insights: '19 days since last check-in. Previous average: 1.8 days between visits.',
        },
      }
    : {
        id: 'demo-action-1',
        approved: null,
        dismissed: null,
        content: {
          memberId: 'demo-m1',
          memberName: 'Sarah Chen',
          memberEmail: 'sarah.chen@email.com',
          riskLevel: 'high' as const,
          riskReason: "Sarah used to come in 4x a week like clockwork. She's been quiet for 19 days — longest gap since she joined 14 months ago.",
          recommendedAction: 'Personal check-in message',
          draftedMessage: "Hey Sarah! Coach Marcus here. Haven't seen you in a few weeks and wanted to check in — everything good? We miss having you in class. If anything's going on or you need to adjust your schedule, just say the word. 💪",
          messageSubject: 'Checking in on you',
          confidence: 91,
          insights: '19 days since last check-in. Previous average: 1.8 days between visits.',
        },
      }

  return NextResponse.json({
    user: { email: 'demo@ironandgrit.com', name: 'Coach Marcus' },
    gym: {
      name: 'PushPress East',
      companyId: 'demo',
      memberCount: 127,
      account_name: 'PushPress East',
      member_count: 127,
    },
    tier: 'pro',
    isDemo: true,
    agents: [
      {
        id: 'demo-ap-1',
        skill_type: 'at_risk_detector',
        name: 'Churn Watcher',
        trigger_mode: 'cron',
        cron_schedule: 'daily',
        is_active: true,
        last_run_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'demo-ap-2',
        skill_type: 'lead_followup',
        name: 'Lead Responder',
        trigger_mode: 'event',
        is_active: true,
        last_run_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
      {
        id: 'demo-ap-3',
        skill_type: 'win_back',
        name: 'Win-Back',
        trigger_mode: 'event',
        is_active: false,
        last_run_at: null,
      },
    ],
    recentRuns: [],
    monthlyRunCount: 47,
    pendingActions: [firstCard],
    recentEvents: [
      { id: 'e1', event_type: 'checkin.created', created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), agent_runs_triggered: 0, processed_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
      { id: 'e2', event_type: 'customer.created', created_at: new Date(Date.now() - 22 * 60 * 1000).toISOString(), agent_runs_triggered: 1, processed_at: new Date(Date.now() - 21 * 60 * 1000).toISOString() },
      { id: 'e3', event_type: 'checkin.created', created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(), agent_runs_triggered: 0, processed_at: new Date(Date.now() - 44 * 60 * 1000).toISOString() },
      { id: 'e4', event_type: 'checkin.created', created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), agent_runs_triggered: 0, processed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
      { id: 'e5', event_type: 'enrollment.created', created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), agent_runs_triggered: 1, processed_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    ],
  })
}
