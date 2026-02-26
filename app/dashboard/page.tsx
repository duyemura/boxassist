'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell from '@/components/AppShell'
import AgentPageLayout from '@/components/AgentPageLayout'
import ReviewQueue from '@/components/ReviewQueue'
import ActionSlidePanel from '@/components/ActionSlidePanel'
import SettingsPanel from '@/components/SettingsPanel'
import GMChat from '@/components/GMChat'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionCard {
  id: string
  content: {
    memberId?: string
    memberName?: string
    memberEmail?: string
    riskLevel?: 'high' | 'medium' | 'low'
    riskReason?: string
    recommendedAction?: string
    draftedMessage?: string
    messageSubject?: string
    confidence?: number
    insights?: string
    playbookName?: string
    estimatedImpact?: string
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
}

// ─── Demo seed ────────────────────────────────────────────────────────────────

const DEMO_AGENTS = [
  { id: 'demo-member-pulse', name: 'At-Risk Monitor', active: true, skill_type: 'at_risk_detector',
    last_run_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), run_count: 47 },
]

// ─── Small components ─────────────────────────────────────────────────────────

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

/** Demo-only marketing pitch shown below the review queue */
function DemoMarketingFooter() {
  return (
    <section style={{ backgroundColor: '#031A3C' }} className="w-full mt-8">
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-white mb-3 tracking-tight leading-tight">
          Get Your GymAgents Now
        </h2>
        <p className="text-gray-400 text-sm mb-2 max-w-xl mx-auto">
          PushPress clients now have a clear AI advantage.
        </p>
        <p className="text-gray-500 text-xs mb-10 max-w-lg mx-auto">Only for PushPress clients.</p>
        <a
          href="/login"
          className="inline-block font-semibold px-8 py-4 text-sm text-white transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#0063FF' }}
        >
          Connect my gym — it&apos;s free
        </a>
        <p className="text-gray-600 text-xs mt-4">No card needed.</p>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-px">
          {[
            { label: 'Churn prevention', heading: "Catches who's drifting before they cancel", body: "At-Risk Monitor scans every member daily. The moment someone's check-in pattern breaks, it flags them and drafts a personal message." },
            { label: 'Autonomous follow-through', heading: 'Follows up until the job is done', body: "Not just one message. The agent keeps the conversation going — responding to replies, adjusting tone, following up if they go quiet." },
            { label: 'Win-back', heading: 'Writes genuine win-back notes', body: "When someone cancels, the agent looks at their history and drafts a sincere note. Not a template. A real message." },
          ].map((f, i) => (
            <div key={i} className="px-6 py-8 border border-white/5">
              <p className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: '#6E7783' }}>{f.label}</p>
              <h3 className="text-white font-semibold text-sm mb-2 leading-snug">{f.heading}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center justify-between">
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
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isDemoParam = searchParams.get('demo') === 'true'
  const [isSandboxDemo, setIsSandboxDemo] = useState(false)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const isDemo = isDemoParam || isSandboxDemo || isPreviewMode

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)
  const [analysisSteps, setAnalysisSteps] = useState<string[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [demoToast, setDemoToast] = useState<string | null>(null)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [selectedAction, setSelectedAction] = useState<ActionCard | null>(null)
  const [mobileTab, setMobileTab] = useState<'queue' | 'chat' | 'settings'>('queue')
  const [activeSection, setActiveSection] = useState<'gm' | 'settings'>('gm')

  // Welcome modal for demo — shows once per session
  const [showWelcome, setShowWelcome] = useState(false)

  const gmChatRef = useRef<import('@/components/GMChat').GMChatHandle>(null)

  // ─── Effects ───────────────────────────────────────────────────────────────

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

      if (!json.isDemo && !json.gym && !isDemoParam) {
        setIsPreviewMode(true)
        const demoRes = await fetch('/api/demo')
        if (demoRes.ok) { setData(await demoRes.json()); return }
      }

      setData(json)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [isDemoParam, router])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  // Default to GM section in demo
  useEffect(() => {
    if (isDemo) setActiveSection('gm')
  }, [isDemo])

  // Show welcome modal once per session for sandbox demo
  useEffect(() => {
    if (isSandboxDemo && data && !sessionStorage.getItem('ga_tour_done')) {
      setTimeout(() => setShowWelcome(true), 600)
    }
  }, [isSandboxDemo, data])

  // Demo idle timeout
  useEffect(() => {
    if (!isSandboxDemo && !isDemoParam) return
    const IDLE_MS = 30 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => router.push('/?demo_expired=1'), IDLE_MS) }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, reset)); reset()
    return () => { clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [isSandboxDemo, isDemoParam, router])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const runScan = async () => {
    setRunning(true)
    setRunResult(null)
    setAnalysisSteps([])
    setActiveSection('gm')

    try {
      const response = await fetch('/api/autopilot/run', { method: 'POST' })
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }))
        setAnalysisSteps([`Error: ${err.error ?? 'Unknown error'}`])
        setRunning(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: Record<string, unknown> | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'status') setAnalysisSteps(prev => [...prev, event.text])
            else if (event.type === 'error') setAnalysisSteps(prev => [...prev, `Error: ${event.message}`])
            else if (event.type === 'done') finalResult = event.result
          } catch { /* skip malformed */ }
        }
      }

      if (finalResult) {
        setRunResult(finalResult)
        if (!isDemo) await fetchDashboard()
        const actions = (finalResult?.output as any)?.actions?.length ?? 0
        gmChatRef.current?.addMessage({
          role: 'assistant',
          content: actions > 0
            ? `Found ${actions} member${actions !== 1 ? 's' : ''} at risk — tasks added above ↑`
            : 'No members at risk right now — all looking good.',
          createdAt: new Date().toISOString(),
        })
      }
    } catch {
      setAnalysisSteps(prev => [...prev, 'Something went wrong — please try again.'])
    }

    setRunning(false)
  }

  const handleMarkDone = async (actionId: string) => {
    setDismissedIds(prev => new Set([...prev, actionId]))
    setSelectedAction(null)
    if (isDemo) return
    try { await fetch('/api/autopilot/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId }) }) } catch {}
  }

  const handleDismiss = async (actionId: string) => {
    setDismissedIds(prev => new Set([...prev, actionId]))
    setSelectedAction(null)
    if (isDemo) return
    try { await fetch('/api/autopilot/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId }) }) } catch {}
  }

  const handleSendDemoEmail = async (actionId: string, message: string, subject: string) => {
    setSendingEmail(true)
    try {
      const res = await fetch('/api/demo/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, subject }) })
      const json = await res.json()
      if (json.sent) { showDemoToast('Email sent! Check your inbox — try replying to it.'); handleMarkDone(actionId) }
      else showDemoToast('Could not send — try again')
    } catch { showDemoToast('Could not send — try again') }
    finally { setSendingEmail(false) }
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#0063FF', borderTopColor: 'transparent' }} />
          <p className="text-gray-400 text-xs">Loading…</p>
        </div>
      </div>
    )
  }

  const autopilots = isDemo ? DEMO_AGENTS : (data?.autopilots ?? [])
  const gymName = isDemo ? 'PushPress East' : (data?.gym?.gym_name ?? data?.gym?.name ?? 'Your Gym')
  const memberCount = data?.gym?.member_count ?? data?.gym?.memberCount ?? 0
  const executionMode: 'manual' | 'limited_auto' = data?.gym?.execution_mode ?? 'manual'

  const atRiskAutopilot = autopilots.find((a: any) => a.skill_type === 'at_risk_detector')
  const gmLastRunAt: string | undefined = atRiskAutopilot?.last_run_at ?? data?.recentRuns?.[0]?.created_at

  // Build de-duped, non-dismissed action list
  const allActions: ActionCard[] = [
    ...(data?.pendingActions || []),
    ...(runResult?.output?.actions?.map((a: any, i: number) => ({
      id: isDemo ? `run-${i}` : `new-${i}`,
      content: a,
      approved: null,
      dismissed: null,
    })) || []),
  ]
  const uniqueActions = allActions
    .filter((a, i, self) => i === self.findIndex(b => b.content?.memberId === a.content?.memberId))
    .filter(a => !dismissedIds.has(a.id))

  // ─── Content ───────────────────────────────────────────────────────────────

  const gmChatNode = (
    <GMChat
      ref={gmChatRef}
      gymId={isDemo ? 'demo-gym' : (data?.gym?.id ?? '')}
      isDemo={isDemo}
      onRunAnalysis={runScan}
      onTaskCreated={() => { if (!isDemo) fetchDashboard() }}
      analysisProgress={{
        steps: analysisSteps,
        isRunning: running,
        onDismiss: () => setAnalysisSteps([]),
      }}
      quickActions={[
        { label: 'Run analysis', onAction: () => gmChatRef.current?.sendMessage('Run analysis') },
        { label: 'Create a task', onAction: () => gmChatRef.current?.sendMessage('Create a task') },
      ]}
    />
  )

  const reviewQueueNode = (
    <>
      <ReviewQueue
        items={uniqueActions}
        onApprove={handleMarkDone}
        onSkip={handleDismiss}
        onSelectItem={setSelectedAction}
        executionMode={executionMode}
      />
      {isDemo && <DemoMarketingFooter />}
    </>
  )

  // Mobile: show queue or chat full-screen based on tab
  const mobileContent = mobileTab === 'chat'
    ? <div className="h-full">{gmChatNode}</div>
    : reviewQueueNode

  const mainContent = (
    <>
      {/* Mobile */}
      <div className="md:hidden h-full overflow-y-auto px-4 py-4">
        {activeSection === 'settings'
          ? <SettingsPanel data={data} isDemo={isDemo} gmailConnected={null} />
          : mobileContent
        }
      </div>

      {/* Desktop */}
      <div className="hidden md:flex flex-col h-full overflow-hidden">
        {activeSection === 'settings' ? (
          <div className="overflow-y-auto flex-1">
            <div className="px-6 pt-5 pb-3 border-b border-gray-100">
              <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
            </div>
            <SettingsPanel data={data} isDemo={isDemo} gmailConnected={null} />
          </div>
        ) : (
          <AgentPageLayout
            agentName="GM Agent"
            agentDescription="Retention · Win-Back · At-Risk"
            status="active"
            lastRunAt={gmLastRunAt}
            memberCount={memberCount}
            onRunNow={runScan}
            isRunning={running}
            runLabel="Run scan"
            executionMode={executionMode}
            queueCount={uniqueActions.length}
            queueSlot={reviewQueueNode}
            chatSlot={gmChatNode}
          />
        )}
      </div>
    </>
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {demoToast && <Toast message={demoToast} />}

      {/* Welcome modal — demo only, once per session */}
      {showWelcome && (() => {
        const visitorCard = uniqueActions[0]
        const visitorName = visitorCard?.content?.memberName
        const isPersonal = visitorCard?.content?.memberId === 'demo-visitor'
        const firstName = visitorName?.split(' ')[0] ?? ''
        const dismiss = () => { setShowWelcome(false); sessionStorage.setItem('ga_tour_done', '1') }
        return (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={dismiss} />
            <div
              className="fixed z-50 bg-white"
              style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(480px, calc(100vw - 32px))', borderRadius: 4 }}
            >
              <div className="h-1 w-full" style={{ backgroundColor: '#0063FF' }} />
              <div className="p-6">
                {isPersonal ? (
                  <>
                    <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: '#0063FF' }}>The agent found you</p>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">{firstName}, you've been flagged.</h2>
                    <p className="text-sm text-gray-500 leading-relaxed mb-4">
                      You just entered this gym as a member. The At-Risk Monitor noticed you haven't been in for 19 days and drafted a personal message — ready for review.
                    </p>
                    <p className="text-sm text-gray-500 leading-relaxed mb-5">
                      <strong className="text-gray-900">This is exactly what your members look like to you.</strong> Click your name to see the suggested message.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: '#0063FF' }}>Welcome to GymAgents</p>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Your agents are watching.</h2>
                    <p className="text-sm text-gray-500 leading-relaxed mb-5">
                      The At-Risk Monitor scanned 247 members and found 3 who need attention. Suggested messages are ready to review above.
                    </p>
                  </>
                )}
                <div className="border-t border-gray-100 pt-4 mb-5 space-y-3">
                  {[
                    { n: '1', text: 'Agents scan your members continuously — attendance, renewals, payments' },
                    { n: '2', text: isPersonal ? 'They flagged you and drafted a suggested message' : 'They flag who needs attention and draft a suggested message' },
                    { n: '3', text: 'Review the queue — approve to send, skip to ignore' },
                  ].map(s => (
                    <div key={s.n} className="flex items-start gap-3">
                      <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: '#0063FF' }}>{s.n}</span>
                      <p className="text-xs text-gray-600 leading-relaxed">{s.text}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button onClick={dismiss} className="text-xs text-gray-400 hover:text-gray-600">Skip</button>
                  <button
                    onClick={() => { dismiss(); if (visitorCard) setSelectedAction(visitorCard) }}
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

      <AppShell
        isDemo={isDemo}
        isSandboxDemo={isSandboxDemo}
        isPreviewMode={isPreviewMode}
        gymName={gymName}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        activeSection={activeSection}
        onSectionChange={(s) => setActiveSection(s as 'gm' | 'settings')}
        slidePanel={
          selectedAction ? (
            <ActionSlidePanel
              action={selectedAction}
              isOpen={!!selectedAction}
              onClose={() => setSelectedAction(null)}
              onDismiss={handleDismiss}
              onMarkDone={handleMarkDone}
              onSendEmail={isDemo ? handleSendDemoEmail : undefined}
              sendingEmail={sendingEmail}
            />
          ) : null
        }
        onSlidePanelClose={() => setSelectedAction(null)}
      >
        {mainContent}
      </AppShell>
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
