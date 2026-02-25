'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import AppShell from '@/components/AppShell'
import GMAgentPanel from '@/components/GMAgentPanel'
import ToDoList, { ToDoItem } from '@/components/ToDoList'
import FleetOverview from '@/components/FleetOverview'
import AgentDetail from '@/components/AgentDetail'
import ActionSlidePanel from '@/components/ActionSlidePanel'
import SettingsPanel from '@/components/SettingsPanel'
import SkillsPanel from '@/components/SkillsPanel'
import CommandBar from '@/components/CommandBar'
import RightPanel from '@/components/RightPanel'
import SkillEditor from '@/components/SkillEditor'
import AgentEditor from '@/components/AgentEditor'
import InstagramConnector from '@/components/InstagramConnector'
import GMChat from '@/components/GMChat'
import RetentionScorecard from '@/components/RetentionScorecard'
import ApprovalQueue from '@/components/ApprovalQueue'
import ActivityFeed from '@/components/ActivityFeed'

// ─── Types ────────────────────────────────────────────────────────────────────

function formatSkillType(slug?: string): string {
  if (!slug) return 'Unknown playbook'
  const map: Record<string, string> = {
    at_risk_detector: 'At-Risk Monitor',
    win_back: 'Lapsed Member Win-Back',
    renewal_guard: 'Renewal At-Risk',
    onboarding: 'New Member Onboarding',
    lead_catcher: 'New Lead Response',
    referral: 'Milestone Referral',
    payment_recovery: 'Failed Payment Recovery',
  }
  return map[slug] ?? slug.replace(/_/g, ' ')
}

interface ActionCard {
  id: string
  content: {
    memberId: string
    memberName: string
    memberEmail: string
    riskLevel: 'high' | 'medium' | 'low'
    riskReason: string
    recommendedAction: string
    draftedMessage: string
    messageSubject: string
    confidence: number
    insights: string
    playbookName?: string
  }
  approved: boolean | null
  dismissed: boolean | null
}

interface DashboardData {
  user: any
  gym: any
  tier: string
  isDemo?: boolean
  autopilots: any[]
  recentRuns: any[]
  pendingActions: ActionCard[]
  monthlyRunCount: number
  recentEvents: Array<{
    id: string
    event_type: string
    created_at: string
    agent_runs_triggered: number
    processed_at: string | null
  }>
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_AGENTS = [
  {
    id: 'demo-member-pulse',
    name: 'At-Risk Monitor',
    active: true,
    skill_type: 'at_risk_detector',
    last_run_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago
    run_count: 47,
  },
  {
    id: 'demo-lead-catcher',
    name: 'New Lead Response',
    active: false,
    skill_type: 'lead_catcher',
    last_run_at: null,
    run_count: 0,
  },
  {
    id: 'demo-renewal-guard',
    name: 'Renewal Follow-up',
    active: false,
    skill_type: 'renewal_guard',
    last_run_at: null,
    run_count: 0,
  },
]

const DEMO_ACTIONS: ActionCard[] = [
  {
    id: 'demo-sarah',
    content: {
      memberId: 'demo-sarah',
      memberName: 'Sarah Chen',
      memberEmail: 'sarah@example.com',
      riskLevel: 'high',
      riskReason: '19 days absent',
      recommendedAction: 'Send a personal check-in message',
      draftedMessage: "Hey Sarah! Coach Marcus here — just wanted to check in. It's been a few weeks since we've seen you, and we miss having you around. Life gets busy, we totally get it. Is there anything we can do to make it easier for you to come back? We'd love to have you in class again. No pressure at all — just wanted to reach out.",
      messageSubject: 'Checking in on you',
      confidence: 0.92,
      insights: 'Sarah has been a member for 14 months and previously checked in 3-4x per week. Her last visit was 19 days ago — the longest gap since joining.',
      playbookName: 'At-Risk Monitor',
    },
    approved: null,
    dismissed: null,
  },
  {
    id: 'demo-derek',
    content: {
      memberId: 'demo-derek',
      memberName: 'Derek Walsh',
      memberEmail: 'derek@example.com',
      riskLevel: 'medium',
      riskReason: 'Renewal in 12 days',
      recommendedAction: 'Reach out before renewal date',
      draftedMessage: "Hey Derek! Just a heads up — your membership renews in about 12 days. Wanted to check in and see how things are going. If you have any questions about your plan or want to chat about your goals, I'm here. Looking forward to seeing you around!",
      messageSubject: 'Your membership renews soon',
      confidence: 0.78,
      insights: "Derek's membership renews on March 6. He's been attending 1-2x/week but showed reduced frequency last month. Proactive outreach reduces churn at renewal.",
      playbookName: 'Renewal At-Risk',
    },
    approved: null,
    dismissed: null,
  },
  {
    id: 'demo-priya',
    content: {
      memberId: 'demo-priya',
      memberName: 'Priya Patel',
      memberEmail: 'priya@example.com',
      riskLevel: 'low',
      riskReason: 'Frequency dropped to 1x/week',
      recommendedAction: 'Friendly check-in',
      draftedMessage: "Hi Priya! Noticed you've been coming in once a week lately — just wanted to check in and make sure everything's going well. If there's anything we can do to help you get more out of your membership, we're all ears. You've been doing great — keep it up!",
      messageSubject: 'How are things going?',
      confidence: 0.65,
      insights: "Priya has been a member for 8 months. She typically attends 3x/week but has dropped to 1x/week over the past 3 weeks.",
      playbookName: 'At-Risk Monitor',
    },
    approved: null,
    dismissed: null,
  },
]

// ─── Tour tooltip ─────────────────────────────────────────────────────────────

function TourTooltip({
  title,
  body,
  onNext,
  onSkip,
  nextLabel = 'Next →',
  showSkip = true,
  style,
}: {
  title: string
  body: string
  onNext: () => void
  onSkip: () => void
  nextLabel?: string
  showSkip?: boolean
  style?: React.CSSProperties
}) {
  return (
    <div
      className="fixed bg-white border border-gray-200 p-4 max-w-xs"
      style={{ zIndex: 60, borderRadius: 4, ...style }}
    >
      <p className="font-semibold text-gray-900 text-sm mb-1">{title}</p>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">{body}</p>
      <div className="flex items-center justify-end gap-3">
        {showSkip && (
          <button onClick={onSkip} className="text-xs text-gray-400 hover:text-gray-600">
            Maybe later
          </button>
        )}
        <button onClick={onNext} className="text-xs font-semibold" style={{ color: '#0063FF' }}>
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message }: { message: string }) {
  return (
    <div
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs font-medium px-4 py-2.5 max-w-xs text-center"
      style={{ borderRadius: 4 }}
    >
      {message}
    </div>
  )
}

// ─── Dashboard content ────────────────────────────────────────────────────────

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isDemoParam = searchParams.get('demo') === 'true'
  const [isSandboxDemo, setIsSandboxDemo] = useState(false)
  // PLG: authenticated users without a gym also see demo/preview mode
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const isDemo = isDemoParam || isSandboxDemo || isPreviewMode

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)
  // Dismissed IDs tracked locally so items disappear immediately on dismiss
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [demoToast, setDemoToast] = useState<string | null>(null)

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedAction, setSelectedAction] = useState<ActionCard | null>(null)

  const selectAction = (action: ActionCard | null) => setSelectedAction(action)
  const [mobileTab, setMobileTab] = useState<'agents' | 'attention' | 'settings'>('agents')
  const [activeSection, setActiveSection] = useState<'agents' | 'members' | 'skills' | 'connectors' | 'settings'>('agents')
  const [instagramConnected, setInstagramConnected] = useState<boolean>(false)
  const [instagramUsername, setInstagramUsername] = useState<string | null>(null)
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<any | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<any | null>(null)
  const [selectedAgentForEdit, setSelectedAgentForEdit] = useState<any | null>(null)
  const [creatingAgent, setCreatingAgent] = useState(false)

  // ─── Tour state ──────────────────────────────────────────────────────────────
  const [tourStep, setTourStep] = useState<0 | 1 | 2 | 3>(0)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null)
  const createBtnRef = useRef<HTMLAnchorElement>(null)
  const firstMemberCardRef = useRef<HTMLDivElement>(null)

  const dismissTour = () => {
    sessionStorage.setItem('ga_tour_done', '1')
    setTourStep(0)
    setTooltipPos(null)
  }

  const advanceTour = () => {
    const next = (tourStep + 1) as 0 | 1 | 2 | 3
    if (next > 3) {
      dismissTour()
    } else {
      setTourStep(next)
    }
  }

  // Auto-start tour — fires once per browser session
  useEffect(() => {
    if (isSandboxDemo && data && !sessionStorage.getItem('ga_tour_done')) {
      setTimeout(() => setTourStep(1), 600)
    }
  }, [isSandboxDemo, data])

  // Demo: default mobile to Attention tab so the to-do list is visible immediately
  useEffect(() => {
    if (isDemo) setMobileTab('attention')
  }, [isDemo])

  // Tour position tracking
  useEffect(() => {
    if (tourStep === 0) {
      setTooltipPos(null)
      return
    }
    requestAnimationFrame(() => {
      if (tourStep === 1) {
        // Spotlight the agent table / first agent row in center
        const agentRow = document.querySelector('[data-agent-row]') as HTMLElement | null
        if (agentRow) {
          const rect = agentRow.getBoundingClientRect()
          setTooltipPos({ top: rect.bottom + 12, left: rect.left })
        } else {
          setTooltipPos({ top: 200, left: 220 })
        }
      } else if (tourStep === 2) {
        // Spotlight the + Create button in left nav
        const createBtn = document.querySelector('[data-create-agent-btn]') as HTMLElement | null
        if (createBtn) {
          const rect = createBtn.getBoundingClientRect()
          setTooltipPos({ top: rect.bottom + 8, left: rect.left })
        } else {
          setTooltipPos({ top: 200, left: 60 })
        }
      } else if (tourStep === 3 && firstMemberCardRef.current) {
        const rect = firstMemberCardRef.current.getBoundingClientRect()
        setTooltipPos({ top: rect.bottom + 12, left: rect.left })
      }
    })
  }, [tourStep])

  const showDemoToast = (msg: string) => {
    setDemoToast(msg)
    setTimeout(() => setDemoToast(null), 3500)
  }

  const fetchDashboard = useCallback(async () => {
    try {
      const url = isDemoParam ? '/api/demo' : '/api/dashboard'
      const res = await fetch(url)
      if (!isDemoParam && res.status === 401) { router.push('/login'); return }
      const json = await res.json()
      if (json.isDemo) setIsSandboxDemo(true)

      // PLG: authenticated user with no gym → switch to preview/demo mode
      // so they see the product before connecting their API key
      if (!json.isDemo && !json.gym && !isDemoParam) {
        setIsPreviewMode(true)
        // Fetch demo data instead so they see the full demo experience
        const demoRes = await fetch('/api/demo')
        if (demoRes.ok) {
          const demoJson = await demoRes.json()
          setData(demoJson)
          return
        }
      }

      setData(json)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [isDemoParam, router])

  useEffect(() => {
    fetchDashboard()
    // Fetch Instagram status quietly
    fetch('/api/connectors/instagram/status').then(r => r.ok ? r.json() : null).then(j => {
      if (j?.connected) { setInstagramConnected(true); setInstagramUsername(j.username ?? null) }
    }).catch(() => {})
  }, [fetchDashboard])

  // Auto-select first agent on load
  useEffect(() => {
    if (!data) return
    const agents = isDemo ? DEMO_AGENTS : (data.autopilots ?? [])
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id)
    }
  }, [data, isDemo, selectedAgentId])

  // Idle timeout for demo
  useEffect(() => {
    if (!isSandboxDemo && !isDemoParam) return
    const IDLE_MS = 30 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { router.push('/?demo_expired=1') }, IDLE_MS)
    }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, reset))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, [isSandboxDemo, isDemoParam, router])

  const runScan = async () => {
    setRunning(true)
    setRunResult(null)
    if (isDemoParam) {
      await new Promise(r => setTimeout(r, 2000))
      setRunResult({ demoMessage: "Found 3 members who need attention — that's what a real scan does with your actual member data" })
      setRunning(false)
      return
    }
    try {
      const res = await fetch('/api/autopilot/run', { method: 'POST' })
      const result = await res.json()
      if (!res.ok) {
        setRunResult({ error: result.error ?? 'Something went wrong — please try again.' })
      } else {
        setRunResult(result)
        await fetchDashboard()
      }
    } catch {
      setRunResult({ error: 'Something went wrong — please try again.' })
    }
    setRunning(false)
  }

  const handleMarkDone = async (actionId: string) => {
    setDismissedIds(prev => new Set([...prev, actionId]))
    setSelectedAction(null)
    if (isDemo) return
    try {
      await fetch('/api/autopilot/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId })
      })
    } catch {}
  }

  const handleDismiss = async (actionId: string) => {
    setDismissedIds(prev => new Set([...prev, actionId]))
    setSelectedAction(null)
    if (isDemo) return
    try {
      await fetch('/api/autopilot/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId })
      })
    } catch {}
  }

  // ─── Derived state ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="text-center">
          <div
            className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: '#0063FF', borderTopColor: 'transparent' }}
          />
          <p className="text-gray-400 text-xs">Loading…</p>
        </div>
      </div>
    )
  }

  // No longer redirect to /connect — PLG preview mode handles this above

  // Use demo agents or real autopilots
  const autopilots = isDemo ? DEMO_AGENTS : (data?.autopilots ?? [])

  // Build actions list
  // In demo mode: prefer API-provided pendingActions (which are personalised to the visitor)
  // Fall back to hardcoded DEMO_ACTIONS only if the API hasn't loaded yet
  const allActions: ActionCard[] = isDemo
    ? (data?.pendingActions && data.pendingActions.length > 0 ? data.pendingActions : DEMO_ACTIONS)
    : [
        ...(data?.pendingActions || []),
        ...(runResult?.output?.actions?.map((a: any, i: number) => ({
          id: `new-${i}`,
          content: a,
          approved: null,
          dismissed: null,
        })) || []),
      ]

  const uniqueActions = allActions
    .filter((a, i, self) => i === self.findIndex(b => b.content?.memberId === a.content?.memberId))
    .filter(a => !dismissedIds.has(a.id))

  const gymName = isDemo
    ? 'PushPress East'
    : (data?.gym?.gym_name ?? data?.gym?.name ?? 'Your Gym')

  const memberCount = data?.gym?.member_count ?? data?.gym?.memberCount ?? 0

  const selectedAgent = autopilots.find((a: any) => a.id === selectedAgentId) ?? null

  // Actions for selected agent (in real mode, filter by agent; in demo, show all for At-Risk Monitor)
  const agentActions = selectedAgentId === 'demo-member-pulse'
    ? uniqueActions
    : isDemo
    ? []
    : uniqueActions

  // Map ActionCard → ToDoItem for the ToDoList component
  const mapActionToToDoItem = (action: ActionCard): ToDoItem => {
    const c = action.content
    const priorityMap: Record<string, ToDoItem['priority']> = {
      high: 'high',
      medium: 'medium',
      low: 'low',
    }
    const insightTypeFromPlaybook = (() => {
      const name = (c.playbookName ?? '').toLowerCase()
      if (name.includes('win') || name.includes('lapsed')) return 'win_back'
      if (name.includes('renewal')) return 'renewal_at_risk'
      if (name.includes('payment')) return 'payment_failed'
      if (name.includes('lead')) return 'new_lead'
      return 'churn_risk'
    })()
    return {
      id: action.id,
      priority: priorityMap[c.riskLevel] ?? 'medium',
      insightType: insightTypeFromPlaybook,
      memberName: c.memberName,
      memberEmail: c.memberEmail,
      title: c.riskReason,
      detail: c.insights ?? '',
      recommendedAction: c.recommendedAction ?? '',
      estimatedImpact: '',  // not in legacy ActionCard; filled by new agent_tasks if available
      draftMessage: c.draftedMessage,
      approved: action.approved,
      dismissed: action.dismissed,
    }
  }

  const todoItems: ToDoItem[] = uniqueActions.map(mapActionToToDoItem)

  // Handler that bridges ToDoItem back to ActionCard for the slide panel
  const handleSelectToDoItem = (item: ToDoItem) => {
    const action = uniqueActions.find(a => a.id === item.id) ?? null
    if (action) selectAction(action)
  }

  // GM Agent stats derived from data
  const gmLastRunAt = isDemo
    ? new Date(Date.now() - 2 * 3_600_000).toISOString()
    : (data?.recentRuns?.[0]?.created_at ?? null)
  const gmInsightsFound = isDemo ? uniqueActions.length : uniqueActions.length
  const gmActiveMembers = memberCount > 0 ? memberCount : undefined
  const gmChurnRisk = uniqueActions.filter(a => a.content?.riskLevel === 'high').length || undefined
  const gmRecentRuns = isDemo
    ? [
        { id: 'dr1', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), insights_generated: 3 },
        { id: 'dr2', created_at: new Date(Date.now() - 27 * 3_600_000).toISOString(), insights_generated: 1 },
        { id: 'dr3', created_at: new Date(Date.now() - 4 * 86_400_000).toISOString(), insights_generated: 6 },
      ]
    : (data?.recentRuns?.map((r: { id: string; created_at: string; actions_taken?: number }) => ({
        id: r.id,
        created_at: r.created_at,
        insights_generated: r.actions_taken ?? 0,
      })) ?? [])

  // Mobile center content depends on tab
  const mobileCenter = mobileTab === 'attention' ? (
    <ToDoList
      items={todoItems}
      onSelectItem={handleSelectToDoItem}
    />
  ) : (
    <GMAgentPanel
      lastRunAt={gmLastRunAt}
      insightsFound={gmInsightsFound}
      activeMembers={gmActiveMembers}
      churnRiskCount={gmChurnRisk}
      onRunAnalysis={runScan}
      isRunning={running}
      recentRuns={gmRecentRuns}
    />
  )

  // Desktop center
  const desktopCenter = (
    <>
      {/* Mobile shows tab-based content */}
      <div className="md:hidden h-full">
        {/* Mobile command bar — always visible */}
        <CommandBar isDemo={isDemo} agents={autopilots} scanning={running} memberCount={memberCount} />
        {mobileCenter}
        {/* Mobile agent detail below table when agent selected */}
        {mobileTab === 'agents' && selectedAgent && (
          <div className="border-t border-gray-100">
            <AgentDetail
              agent={selectedAgent}
              actions={agentActions}
              onSelectAction={(a: ActionCard) => selectAction(a)}
              onSelectRun={setSelectedRun}
              isDemo={isDemo}
              onScanNow={runScan}
              scanning={running}
              memberCount={memberCount}
              runResult={runResult}
            />
          </div>
        )}
      </div>
      {/* Desktop: center content switches based on active nav section */}
      <div className="hidden md:flex md:flex-col h-full overflow-hidden">
        {activeSection === 'agents' && !selectedRun && !selectedAgentForEdit && !creatingAgent && (
          <div className="flex flex-col h-full">
            {isDemo ? (
              <>
                {/* Demo: sticky header with Run Analysis always visible */}
                <div className="flex-shrink-0 border-b border-gray-100 px-4 py-2 flex items-center justify-between gap-4 bg-white">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">At-Risk Monitor</span>
                    <span className="text-[10px] text-gray-400">· last run 2h ago</span>
                  </div>
                  <button
                    onClick={runScan}
                    disabled={running}
                    className="text-[10px] font-semibold text-white px-2.5 py-1 transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-1"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    {running ? (
                      <>
                        <span className="w-2 h-2 rounded-full border border-white border-t-transparent animate-spin" />
                        Scanning…
                      </>
                    ) : (
                      'Run Analysis'
                    )}
                  </button>
                </div>
                <ToDoList items={todoItems} onSelectItem={handleSelectToDoItem} />
              </>
            ) : (
              <>
                {/* Collapsed stats bar (replaces standalone GMAgentPanel) */}
                <div className="flex-shrink-0 border-b border-gray-100 px-4 py-2 flex items-center justify-between gap-4 bg-white">
                  <div className="flex items-center gap-3">
                    {gmActiveMembers !== undefined && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest">Members</span>
                        <span className="text-xs font-semibold text-gray-900">{gmActiveMembers.toLocaleString()}</span>
                      </div>
                    )}
                    {gmChurnRisk !== undefined && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest">Churn Risk</span>
                        <span className="text-xs font-semibold text-gray-900">{gmChurnRisk}</span>
                      </div>
                    )}
                    {gmLastRunAt && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest">Last run</span>
                        <span className="text-xs text-gray-500">
                          {(() => {
                            const diff = Date.now() - new Date(gmLastRunAt).getTime()
                            const m = Math.floor(diff / 60_000)
                            const h = Math.floor(diff / 3_600_000)
                            const d = Math.floor(diff / 86_400_000)
                            if (m < 1) return 'just now'
                            if (m < 60) return `${m}m ago`
                            if (h < 24) return `${h}h ago`
                            return `${d}d ago`
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={runScan}
                    disabled={running}
                    className="text-[10px] font-semibold text-white px-2.5 py-1 transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-1"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    {running && (
                      <span
                        className="w-2 h-2 rounded-full border border-white animate-spin"
                        style={{ borderTopColor: 'transparent' }}
                      />
                    )}
                    {running ? 'Running…' : 'Run Analysis'}
                  </button>
                </div>
                {/* GM Chat — fills remaining space */}
                <div className="flex-1 overflow-hidden">
                  <GMChat
                    gymId={data?.gym?.id ?? ''}
                    isDemo={false}
                    onTaskCreated={(_taskId) => {
                      fetchDashboard()
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {/* Agent editor — create or edit */}
        {activeSection === 'agents' && (selectedAgentForEdit || creatingAgent) && !selectedRun && (
          <AgentEditor
            agent={creatingAgent ? null : selectedAgentForEdit}
            isDemo={isDemo}
            onBack={() => { setSelectedAgentForEdit(null); setCreatingAgent(false) }}
            onSaved={() => fetchDashboard()}
            onDeleted={() => { setSelectedAgentForEdit(null); setCreatingAgent(false); fetchDashboard() }}
          />
        )}
        {activeSection === 'agents' && selectedRun && (
          <div className="p-8 max-w-lg">
            <button
              onClick={() => setSelectedRun(null)}
              className="text-xs text-gray-400 hover:text-gray-700 mb-6 flex items-center gap-1 transition-colors"
            >
              ← Back to agents
            </button>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Run detail</p>
              {/* Playbook attribution — Claude Code style */}
              {(selectedRun.skill_name || selectedRun.skill_type || selectedRun.playbookName) && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-gray-400 uppercase tracking-wide">Playbook used</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5" style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.07)' }}>
                    {selectedRun.playbookName ?? selectedRun.skill_name ?? formatSkillType(selectedRun.skill_type)}
                  </span>
                </div>
              )}
            </div>
            <div className="border border-gray-100 divide-y divide-gray-100">
              <div className="flex justify-between px-4 py-3">
                <span className="text-xs text-gray-500">Date</span>
                <span className="text-xs text-gray-900 font-medium">{selectedRun.label ?? (selectedRun.completed_at ? new Date(selectedRun.completed_at).toLocaleString() : '—')}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-xs text-gray-500">Members scanned</span>
                <span className="text-xs text-gray-900 font-medium">{selectedRun.scanned ?? selectedRun.members_scanned ?? '—'}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-xs text-gray-500">Flagged</span>
                <span className="text-xs text-gray-900 font-medium">{selectedRun.flagged ?? selectedRun.actions_taken ?? 0}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-xs text-gray-500">Messages sent</span>
                <span className="text-xs text-gray-900 font-medium">{selectedRun.scanned ?? selectedRun.messages_sent ?? '—'}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-xs text-gray-500">Est. value</span>
                <span className="text-xs text-gray-900 font-medium">{selectedRun.value ?? (selectedRun.attributed_value_usd ? `$${Math.round(selectedRun.attributed_value_usd)}` : '—')}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-xs text-gray-500">Agent cost</span>
                <span className="text-xs text-gray-900 font-medium">{selectedRun.cost ?? (selectedRun.billed_usd ? `$${parseFloat(selectedRun.billed_usd).toFixed(2)}` : '—')}</span>
              </div>
              {selectedRun.value && selectedRun.cost && (
                <div className="flex justify-between px-4 py-3">
                  <span className="text-xs text-gray-500">ROI</span>
                  <span className="text-xs font-semibold" style={{ color: '#22c55e' }}>
                    {selectedRun.flagged > 0 ? `${Math.round((parseInt(selectedRun.value?.replace(/\D/g,'') || '0') / parseFloat(selectedRun.cost?.replace('$','') || '1')))}x` : '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {activeSection === 'skills' && !selectedSkill && (
          <>
            <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
              <h1 className="text-lg font-semibold text-gray-900">Playbooks</h1>
            </div>
            <SkillsPanel isDemo={isDemo} onSelectSkill={setSelectedSkill} />
          </>
        )}
        {activeSection === 'skills' && selectedSkill && (
          <SkillEditor
            skill={selectedSkill}
            isDemo={isDemo}
            onBack={() => setSelectedSkill(null)}
            onSaved={() => {}}
            onDeleted={() => setSelectedSkill(null)}
          />
        )}
        {activeSection === 'connectors' && !selectedConnector && (
          <div className="p-8">
            <h1 className="text-lg font-semibold text-gray-900 mb-6">Connectors</h1>
            <div className="space-y-px">
              {[
                { name: 'PushPress', desc: 'Member data, check-ins, billing, and membership status.', connected: true },
                { name: 'Gmail', desc: 'Connect your Gmail to send outreach from your real address.', connected: false, soon: true },
                { name: 'Instagram', desc: 'Auto-post member milestones, retention wins, and class highlights.', connected: instagramConnected, action: () => setSelectedConnector('instagram') },
                { name: 'SMS / Twilio', desc: 'Text members directly from the agent.', connected: false, soon: true },
                { name: 'Zapier', desc: 'Connect to 5,000+ apps and automate workflows.', connected: false, soon: true },
              ].map(c => (
                <div key={c.name} className="flex items-start justify-between py-4 border-b border-gray-100">
                  <div>
                    <p className={`text-sm font-medium ${(c as any).soon ? 'text-gray-300' : 'text-gray-900'}`}>{c.name}</p>
                    <p className={`text-xs mt-0.5 ${(c as any).soon ? 'text-gray-200' : 'text-gray-400'}`}>{c.desc}</p>
                  </div>
                  <div className="flex-shrink-0 ml-4 mt-0.5">
                    {c.connected && (c as any).action && (
                      <button onClick={(c as any).action} className="text-[10px] font-medium text-green-600 hover:underline">Connected</button>
                    )}
                    {c.connected && !(c as any).action && (
                      <span className="text-[10px] font-medium text-green-600">Connected</span>
                    )}
                    {!c.connected && !(c as any).soon && (
                      <button onClick={(c as any).action} className="text-[10px] font-medium underline" style={{ color: '#0063FF' }}>Connect</button>
                    )}
                    {(c as any).soon && <span className="text-[10px] text-gray-300 font-medium">Soon</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeSection === 'connectors' && selectedConnector === 'instagram' && (
          <InstagramConnector
            initialConnected={instagramConnected}
            initialUsername={instagramUsername}
            onBack={() => {
              setSelectedConnector(null)
              // Refresh Instagram status when navigating back
              fetch('/api/connectors/instagram/status')
                .then(r => r.ok ? r.json() : null)
                .then(j => {
                  setInstagramConnected(j?.connected ?? false)
                  setInstagramUsername(j?.username ?? null)
                })
                .catch(() => {})
            }}
          />
        )}
        {activeSection === 'settings' && (
          <>
            <div className="px-6 pt-5 pb-3 border-b border-gray-100">
              <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
            </div>
            <SettingsPanel
              data={data}
              isDemo={isDemo}
              gmailConnected={null}
            />
          </>
        )}
      </div>
    </>
  )

  return (
    <>
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .tour-spotlight {
          position: relative;
          z-index: 50;
          box-shadow: 0 0 0 4px #0063FF, 0 0 0 9999px rgba(0,0,0,0.55);
        }
      `}</style>

      {/* Welcome modal — centered, no DOM positioning needed */}
      {tourStep === 1 && (() => {
        const visitorCard = uniqueActions[0]
        const visitorName = visitorCard?.content?.memberName
        const isPersonal = visitorCard?.content?.memberId === 'demo-visitor'
        const firstName = visitorName?.split(' ')[0] ?? ''
        return (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/40 z-40" onClick={dismissTour} />
            {/* Modal */}
            <div
              className="fixed z-50 bg-white shadow-2xl"
              style={{
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(480px, calc(100vw - 32px))',
                borderRadius: 4,
              }}
            >
              {/* Blue accent top bar */}
              <div className="h-1 w-full" style={{ backgroundColor: '#0063FF' }} />

              <div className="p-6">
                {isPersonal ? (
                  <>
                    <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: '#0063FF' }}>
                      The agent found you
                    </p>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">
                      {firstName}, you've been flagged.
                    </h2>
                    <p className="text-sm text-gray-500 leading-relaxed mb-4">
                      You just entered this gym as a member. The At-Risk Monitor noticed you haven't been in for 19 days and drafted a personal message from the coach — ready for you to copy and send yourself.
                    </p>
                    <p className="text-sm text-gray-500 leading-relaxed mb-5">
                      <strong className="text-gray-900">This is exactly what your members look like to you.</strong> Check the to-do list — you're at the top. Click your name to see the suggested message.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: '#0063FF' }}>
                      Welcome to GymAgents
                    </p>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">
                      Your agents are watching.
                    </h2>
                    <p className="text-sm text-gray-500 leading-relaxed mb-4">
                      The At-Risk Monitor scanned 247 members and found 3 who need attention. Suggested messages are ready for you to copy and use — check the to-do list.
                    </p>
                  </>
                )}

                {/* 3-step explainer */}
                <div className="border-t border-gray-100 pt-4 mb-5 space-y-3">
                  {[
                    { n: '1', text: 'Agents scan your members continuously — attendance, renewals, payments' },
                    { n: '2', text: isPersonal ? 'They flagged you and drafted a suggested message' : 'They flag who needs attention and draft a suggested message' },
                    { n: '3', text: 'You copy the message, reach out yourself, and mark it done' },
                  ].map(s => (
                    <div key={s.n} className="flex items-start gap-3">
                      <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: '#0063FF' }}>{s.n}</span>
                      <p className="text-xs text-gray-600 leading-relaxed">{s.text}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button onClick={dismissTour} className="text-xs text-gray-400 hover:text-gray-600">
                    Skip tour
                  </button>
                  <button
                    onClick={() => {
                      dismissTour()
                      if (visitorCard) selectAction(visitorCard)
                    }}
                    className="text-xs font-semibold text-white px-4 py-2 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    {isPersonal ? `See your message →` : 'See the first flag →'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )
      })()}

      {demoToast && <Toast message={demoToast} />}

      <AppShell
        isDemo={isDemo}
        isSandboxDemo={isSandboxDemo}
        isPreviewMode={isPreviewMode}
        gymName={gymName}
        agents={autopilots}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        statsBar={isDemo ? undefined : <RetentionScorecard />}
        rightPanel={
          isDemo ? (
            <div className="flex flex-col h-full">
              {/* What the agent did */}
              <div className="px-4 py-4 border-b border-gray-100 flex-shrink-0">
                <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">Last run — 2h ago</p>
                {[
                  { icon: '→', text: 'Scanned 247 members for attendance patterns' },
                  { icon: '!', text: `Found ${todoItems.length} at-risk signal${todoItems.length !== 1 ? 's' : ''}` },
                  { icon: '✓', text: `Drafted ${todoItems.length} personal outreach message${todoItems.length !== 1 ? 's' : ''}` },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2">
                    <span className="text-gray-400 text-xs w-4 flex-shrink-0 mt-0.5">{item.icon}</span>
                    <p className="text-xs text-gray-600">{item.text}</p>
                  </div>
                ))}
              </div>

              <div className="flex-1" />
              <div className="p-4 border-t border-gray-100 flex-shrink-0">
                <p className="text-xs text-gray-500 mb-3 leading-relaxed">Connect your gym to run this on your real member data every day.</p>
                <a
                  href="/login"
                  className="block w-full text-center text-xs font-semibold text-white py-2.5 transition-opacity hover:opacity-80"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  Connect my gym — it&apos;s free →
                </a>
                <p className="text-[10px] text-gray-400 mt-2 text-center">PushPress gyms only · No card needed</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <ToDoList
                items={todoItems}
                onSelectItem={handleSelectToDoItem}
              />
              <div className="border-t border-gray-100">
                <ActivityFeed />
              </div>
            </div>
          )
        }
        slidePanel={
          selectedAction
            ? (
              <ActionSlidePanel
                action={selectedAction}
                isOpen={!!selectedAction}
                onClose={() => setSelectedAction(null)}
                onDismiss={handleDismiss}
                onMarkDone={handleMarkDone}
              />
            )
            : null
        }
        onSlidePanelClose={() => setSelectedAction(null)}
        activeSection={activeSection}
        onSectionChange={(s) => { setActiveSection(s); setSelectedSkill(null); setSelectedRun(null); setSelectedAgentForEdit(null); setCreatingAgent(false); setSelectedConnector(null) }}
      >
        {desktopCenter}
      </AppShell>

      {/* Marketing section below the shell — demo only */}
      {isDemo && (
        <section style={{ backgroundColor: '#031A3C' }} className="w-full">
          <div className="max-w-4xl mx-auto px-6 py-16 text-center">
            <h2 className="text-3xl font-bold text-white mb-4 tracking-tight leading-tight">
              Get Your GymAgents Now
            </h2>
            <p className="text-gray-400 text-base mb-2 max-w-xl mx-auto">
              PushPress clients now have a clear AI advantage.
            </p>
            <p className="text-gray-500 text-sm mb-10 max-w-lg mx-auto">
              Only for PushPress clients.
            </p>
            <a
              href="/login"
              className="inline-block font-semibold px-8 py-4 text-sm text-white transition-colors"
              style={{ backgroundColor: '#0063FF' }}
            >
              Connect my gym — it&apos;s free
            </a>
            <p className="text-gray-600 text-xs mt-4">No card needed.</p>
          </div>

          <div className="border-t border-white/10">
            <div className="max-w-4xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-px">
              {[
                { label: 'Churn prevention', heading: "Catches who's drifting before they cancel", body: "At-Risk Monitor scans every member daily. The moment someone's check-in pattern breaks, it flags them and drafts a personal message." },
                { label: 'Autonomous follow-through', heading: 'Follows up until the job is done', body: "Not just one message. The agent keeps the conversation going — responding to replies, adjusting tone, following up weekly if they go quiet." },
                { label: 'Lead response', heading: 'Replies to new leads in minutes', body: "A new inquiry comes in while you're coaching. GymAgents drafts a warm, personal reply in your voice." },
                { label: 'Win-back', heading: 'Writes genuine win-back notes', body: "When someone cancels, the agent looks at their history and drafts a sincere note. Not a template. A real message." },
                { label: 'Payment recovery', heading: 'Handles failed payments gracefully', body: "A friendly, non-embarrassing message is drafted the moment a payment fails — ready to copy, personalize, and send yourself." },
                { label: 'Build your own', heading: 'Describe it in plain English. It runs.', body: "Want something custom? Just say what you want it to do. GymAgents figures out the logic, the timing, and the action." },
              ].map((f, i) => (
                <div key={i} className="px-8 py-10 border border-white/5">
                  <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: '#6E7783' }}>{f.label}</p>
                  <h3 className="text-white font-semibold text-sm mb-3 leading-snug">{f.heading}</h3>
                  <p className="text-gray-500 text-xs leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10">
            <div className="max-w-4xl mx-auto px-6 py-16">
              <div className="grid md:grid-cols-2 gap-8 mb-16">
                {[
                  { name: 'Marcus T.', gym: 'Apex Strength & Conditioning', quote: "Used to spend Sunday mornings going through my list. GymAgents does it every day now. Got three people back the first week." },
                  { name: 'Derek L.', gym: 'Ground Zero BJJ', quote: "Monthly churn was at 7%. First month with GymAgents I dropped it to 4.5%. At $130 a member that's real money." },
                ].map((t, i) => (
                  <div key={i} className="border-l-2 pl-5" style={{ borderColor: '#0063FF' }}>
                    <p className="text-gray-300 text-sm leading-relaxed mb-4">&ldquo;{t.quote}&rdquo;</p>
                    <p className="text-xs text-gray-500">{t.name} · {t.gym}</p>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <h3 className="text-white font-semibold text-lg mb-2">One kept member pays for a year of GymAgents.</h3>
                <p className="text-gray-500 text-sm mb-8">Free to start. Most gyms are connected in under 2 minutes.</p>
                <a
                  href="/login"
                  className="inline-block font-semibold px-8 py-4 text-sm text-white transition-colors"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  Connect my gym — it&apos;s free
                </a>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10">
            <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center" style={{ backgroundColor: '#0063FF' }}>
                  <span className="text-white font-bold text-xs">G</span>
                </div>
                <span className="text-xs text-gray-500 font-medium">GymAgents</span>
                <span className="text-gray-700 text-xs">· Powered by PushPress</span>
              </div>
              <p className="text-xs text-gray-600">PushPress gyms only</p>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="text-gray-300 text-xs">Loading…</div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
