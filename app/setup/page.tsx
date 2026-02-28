'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import AgentPromptBuilder from '@/components/AgentPromptBuilder'

// ── Types ────────────────────────────────────────────────────────────────────

interface RecommendationStat {
  label: string
  value: string | number
  emphasis?: boolean
}

interface Recommendation {
  agentType: string
  name: string
  description: string
  headline: string
  reasoning: string
  stats: RecommendationStat[]
  trigger: {
    mode: 'cron' | 'event'
    schedule?: string
    event?: string
  }
}

interface RunAction {
  memberName?: string
  riskReason?: string
  insights?: string
  riskLevel?: string
}

// ── Schedule options ─────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { id: 'daily', label: 'Daily', description: 'Every morning', mode: 'cron', schedule: 'daily' },
  { id: 'weekly', label: 'Weekly', description: 'Every Monday', mode: 'cron', schedule: 'weekly' },
  { id: 'event', label: 'On Event', description: 'Something happens in PushPress', mode: 'event', schedule: null },
  { id: 'manual', label: 'Manual', description: 'You run it yourself', mode: 'manual', schedule: null },
]

const PUSHPRESS_EVENTS = [
  { value: 'member.cancelled', label: 'Member cancelled their membership' },
  { value: 'lead.created', label: 'New lead submitted (trial, walk-in)' },
  { value: 'member.created', label: 'New member signed up' },
  { value: 'payment.failed', label: 'Membership payment failed' },
  { value: 'checkin.created', label: 'Member checked into the gym' },
]

function scheduleLabel(triggerId: string, hour: number): string {
  const h = hour === 0 ? '12am' : hour === 12 ? '12pm' : hour < 12 ? `${hour}am` : `${hour - 12}pm`
  if (triggerId === 'daily') return `Runs daily at ${h} your gym's local time`
  if (triggerId === 'weekly') return `Runs every Monday at ${h} your gym's local time`
  if (triggerId === 'event') return 'Triggers on gym events'
  return 'Run manually'
}

// ── How it works — per agent type ────────────────────────────────────────────

function getHowItWorks(rec: Recommendation): string[] {
  const trigger = rec.trigger.mode === 'cron'
    ? rec.trigger.schedule === 'daily' ? 'Every morning' : 'Every Monday'
    : 'When the event fires'

  switch (rec.agentType) {
    case 'at_risk_detector':
      return [
        `${trigger}, the agent scans your PushPress check-in data for members whose attendance is dropping or who've stopped showing up.`,
        'For each at-risk member, it drafts a personal check-in message — written in your voice, not a generic template.',
        'The drafts show up in your dashboard for you to review. Approve, edit, or skip each one.',
        'Approved messages get sent as emails from your gym. If they reply, you see it in your dashboard.',
      ]
    case 'payment_recovery':
      return [
        'When a membership payment fails in PushPress, the agent picks it up automatically.',
        'It drafts a friendly heads-up to the member — no guilt, just "hey, your payment didn\'t go through."',
        'You review the draft in your dashboard before anything sends.',
        'If the member replies or fixes their payment, the agent tracks the outcome.',
      ]
    case 'win_back':
      return [
        'When a member cancels in PushPress, the agent creates a win-back task within hours.',
        'It drafts a personal note — not a "we miss you" template, but something specific to that member.',
        'You review and approve the message before it sends.',
        'If they don\'t reply, it follows up twice more over 10 days, then stops.',
      ]
    case 'new_member_onboarding':
      return [
        `${trigger}, the agent checks for members in their first 30 days who might need a check-in.`,
        'It drafts a personal message — "how\'s it going?" style, not a sales pitch.',
        'You review each message in your dashboard before it sends.',
        'It tracks whether new members keep showing up after the check-in.',
      ]
    case 'lead_reactivation':
      return [
        `${trigger}, the agent identifies old leads in your PushPress system who never converted.`,
        'It drafts a low-pressure personal message — "still thinking about it?" not "BUY NOW."',
        'You review every message before it goes out. Nothing sends automatically.',
        'If a lead replies, you see the conversation in your dashboard and can take over anytime.',
      ]
    case 'lead_followup':
      return [
        'When a new lead comes into PushPress, the agent drafts a same-day follow-up message.',
        'The message is personal and conversational — based on what the lead signed up for.',
        'You review and approve the message in your dashboard before it sends.',
        'If they reply, the agent handles the back-and-forth or flags you to jump in.',
      ]
    default:
      return [
        `${trigger}, the agent analyzes your PushPress data to find members who need attention.`,
        'It drafts a personal message for each member it flags.',
        'You review every message in your dashboard before anything sends.',
        'It tracks whether outreach leads to the member coming back.',
      ]
  }
}

// ── Shared header ─────────────────────────────────────────────────────────────

function Header({ onSkip }: { onSkip?: () => void }) {
  return (
    <header className="h-12 bg-white border-b border-gray-100 flex items-center px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 flex items-center justify-center" style={{ backgroundColor: '#0063FF' }}>
          <span className="font-bold text-[10px] text-white">G</span>
        </div>
        <span className="font-semibold text-sm text-gray-900">GymAgents</span>
        <span className="text-xs text-gray-400 ml-2">Gym Setup</span>
      </div>
      {onSkip && (
        <>
          <div className="flex-1" />
          <button
            onClick={onSkip}
            className="text-xs transition-colors"
            style={{ color: '#9CA3AF' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#6B7280')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
          >
            Skip for now
          </button>
        </>
      )}
    </header>
  )
}

// ── Progress ─────────────────────────────────────────────────────────────────

function Progress({ step }: { step: number }) {
  const labels = ['Build', 'Customize']
  return (
    <div className="flex items-center gap-0 mb-10">
      {labels.map((label, i) => {
        const s = i + 1
        const active = step === s
        const done = step > s
        return (
          <div key={s} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <div
                className="w-5 h-5 flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  backgroundColor: done ? '#0063FF' : active ? '#080808' : '#E5E7EB',
                  color: done || active ? 'white' : '#9CA3AF',
                }}
              >
                {done ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : s}
              </div>
              <span className="text-xs font-medium" style={{ color: active ? '#080808' : done ? '#0063FF' : '#9CA3AF' }}>
                {label}
              </span>
            </div>
            {s < 2 && <div className="w-8 h-px mx-2" style={{ backgroundColor: step > s ? '#0063FF' : '#E5E7EB' }} />}
          </div>
        )
      })}
    </div>
  )
}

// ── Loading screen ────────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Connecting to your gym\'s PushPress data…',
  'Analyzing member check-in patterns…',
  'Looking at membership and payment history…',
  'Checking class attendance trends…',
  'Identifying members who need attention…',
  'Building your gym\'s first agent…',
]

function LoadingScreen() {
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % LOADING_MESSAGES.length)
    }, 2200)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
      <div className="text-center max-w-sm w-full">
        <div className="relative w-12 h-12 mx-auto mb-6">
          <div className="absolute inset-0 animate-ping opacity-20" style={{ backgroundColor: '#0063FF' }} />
          <div className="relative w-12 h-12 flex items-center justify-center" style={{ backgroundColor: '#0063FF' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Build your first GymAgent</h2>
        <p className="text-xs text-gray-400 mb-4">Analyzing your gym to recommend a high-value agent based on your data.</p>
        <p className="text-sm transition-opacity duration-500" style={{ color: '#6B7280' }} key={msgIndex}>
          {LOADING_MESSAGES[msgIndex]}
        </p>
      </div>
    </div>
  )
}

// ── Recommendation card ──────────────────────────────────────────────────────

function formatSyncAge(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function RecommendationCard({
  rec, accountName, onAccept, onCustomize, onSkip, lastSyncedAt, wasCached, onRefresh,
}: {
  rec: Recommendation
  accountName: string
  onAccept: () => void
  onCustomize: () => void
  onSkip: () => void
  lastSyncedAt: string | null
  wasCached: boolean
  onRefresh: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8F9FB' }}>
      <Header onSkip={onSkip} />
      <div className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-xl">
          {/* Top header: context → label → name → description → reasoning */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-900 mb-0.5">Build your first GymAgent</h2>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-4">
              RECOMMENDED FOR {accountName.toUpperCase()}
            </p>
            <h1 className="text-xl font-bold text-gray-900">{rec.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{rec.description}</p>
            <div className="mt-4 px-4 py-3 flex items-start gap-3" style={{ backgroundColor: '#F0F6FF', borderLeft: '3px solid #0063FF' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0063FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p className="text-sm text-gray-800 leading-snug">{rec.reasoning}</p>
            </div>
          </div>

          {/* Stats + sync timestamp */}
          <div className="flex gap-3 mb-1.5">
            {rec.stats.map((stat, i) => (
              <div key={i} className="flex-1 border p-4 bg-white" style={{ borderColor: stat.emphasis ? '#0063FF' : '#E5E7EB' }}>
                <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1">{stat.label}</p>
                <p className="text-lg font-bold" style={{ color: stat.emphasis ? '#0063FF' : '#111827' }}>{stat.value}</p>
              </div>
            ))}
          </div>
          {lastSyncedAt && (
            <div className="flex items-center gap-2 mb-4">
              <p className="text-[10px] text-gray-400">
                {wasCached ? 'Using data from' : 'Data pulled'} {formatSyncAge(lastSyncedAt)}
              </p>
              {wasCached && (
                <button
                  onClick={onRefresh}
                  className="text-[10px] font-semibold transition-colors"
                  style={{ color: '#0063FF' }}
                >
                  Refresh
                </button>
              )}
            </div>
          )}
          {!lastSyncedAt && <div className="mb-4" />}

          {/* How it works panel */}
          <div className="bg-white border border-gray-200 p-5 mb-6">
            <h3 className="text-sm font-bold text-gray-900 mb-3">How it works</h3>
            <div className="space-y-2.5">
              {getHowItWorks(rec).map((howStep, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-gray-400" style={{ backgroundColor: '#F3F4F6' }}>
                    {i + 1}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{howStep}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-start gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <p className="text-xs text-gray-400">Nothing sends without your approval.</p>
            </div>
          </div>

          <div className="space-y-2">
            <button onClick={onAccept} className="w-full py-3 text-sm font-bold text-white transition-opacity hover:opacity-80" style={{ backgroundColor: '#0063FF' }}>
              Start with this agent →
            </button>
            <button onClick={onCustomize} className="w-full py-3 text-sm font-medium border border-gray-200 bg-white transition-colors hover:bg-gray-50" style={{ color: '#6B7280' }}>
              I'll customize it first
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── First-run screen ──────────────────────────────────────────────────────────

function FirstRunScreen({
  agentName, description, trigger, runHour, onRun, onSkip,
}: {
  agentName: string
  description: string
  trigger: string
  runHour: number
  onRun: () => void
  onSkip: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8F9FB' }}>
      <Header />
      <div className="flex-1 flex flex-col items-center px-4 py-16">
        <div className="w-full max-w-md">

          {/* Agent created badge */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-4 h-4 flex items-center justify-center" style={{ backgroundColor: '#059669' }}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Agent created</span>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Let's run your {agentName} Agent.
          </h1>
          <p className="text-sm text-gray-400 mb-8">
            It'll scan your live PushPress data and show you what it finds. Takes about 20 seconds.
          </p>

          {/* Agent card */}
          <div className="bg-white border border-gray-200 p-5 mb-8">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: '#0063FF' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-gray-900">{agentName}</h3>
                {description && <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
              <div className="w-1.5 h-1.5 flex-shrink-0" style={{ backgroundColor: '#059669' }} />
              <span className="text-xs text-gray-500">{scheduleLabel(trigger, runHour)}</span>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={onRun}
            className="w-full py-4 text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#0063FF' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Run {agentName} now
          </button>

          <button
            onClick={onSkip}
            className="w-full mt-3 py-2 text-xs text-center transition-colors"
            style={{ color: '#9CA3AF' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#6B7280')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
          >
            Skip — I'll run it from the dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Running screen ────────────────────────────────────────────────────────────

function RunningScreen({ agentName, statusMessages }: { agentName: string; statusMessages: string[] }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
      <div className="max-w-sm w-full px-4">

        {/* Pulse icon */}
        <div className="relative w-12 h-12 mx-auto mb-8">
          <div className="absolute inset-0 animate-ping opacity-20" style={{ backgroundColor: '#0063FF' }} />
          <div className="relative w-12 h-12 flex items-center justify-center" style={{ backgroundColor: '#0063FF' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </div>
        </div>

        <h2 className="text-lg font-bold text-gray-900 text-center mb-6">
          Running {agentName}…
        </h2>

        {/* Live status feed */}
        <div className="space-y-3">
          {statusMessages.map((msg, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#059669' }}>
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="text-sm text-gray-500">{msg}</span>
            </div>
          ))}
          {/* Current step */}
          <div className="flex items-center gap-3">
            <span
              className="w-4 h-4 border border-blue-500 border-t-transparent flex-shrink-0 animate-spin"
              style={{ borderRadius: '50%' }}
            />
            <span className="text-sm text-gray-700">Working…</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Results screen ────────────────────────────────────────────────────────────

function ResultsScreen({
  agentName, actions, onContinue,
}: {
  agentName: string
  actions: RunAction[]
  onContinue: () => void
}) {
  const found = actions.length

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8F9FB' }}>
      <Header />
      <div className="flex-1 flex flex-col items-center px-4 py-16">
        <div className="w-full max-w-md">

          <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">
            First run complete
          </p>

          {found > 0 ? (
            <>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {agentName} found {found} {found === 1 ? 'item' : 'items'}.
              </h1>
              <p className="text-sm text-gray-400 mb-8">
                {found === 1 ? "It's been" : "They've been"} added to your To-Do list on the dashboard.
              </p>

              <div className="flex flex-col gap-1.5 mb-8">
                {actions.slice(0, 5).map((action, i) => (
                  <div key={i} className="bg-white border border-gray-200 px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">{action.memberName ?? 'Member'}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                      {action.riskReason ?? action.insights ?? 'Needs attention'}
                    </p>
                  </div>
                ))}
                {found > 5 && (
                  <p className="text-xs text-gray-400 text-center pt-1">
                    +{found - 5} more on the dashboard
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                All clear for now.
              </h1>
              <p className="text-sm text-gray-400 mb-8">
                {agentName} didn't find anything urgent right now. It'll keep watching and alert you as soon as something comes up.
              </p>
            </>
          )}

          <button
            onClick={onContinue}
            className="w-full py-4 text-sm font-bold text-white transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#0063FF' }}
          >
            Go to my dashboard →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

type Phase = 'loading' | 'loading-error' | 'recommendation' | 'build' | 'first-run' | 'running' | 'results'

export default function SetupPage() {
  const router = useRouter()

  // Phase
  const [phase, setPhase] = useState<Phase>('loading')
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)
  const [accountName, setAccountName] = useState('')
  const [loadError, setLoadError] = useState('')
  const [fromRecommendation, setFromRecommendation] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [wasCached, setWasCached] = useState(false)

  // Build fields
  const [agentName, setAgentName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [agentSkillType, setAgentSkillType] = useState('')  // from recommendation.agentType
  const [fastPath, setFastPath] = useState(false)          // accepted rec without going through build step

  // Schedule fields
  const [selectedTrigger, setSelectedTrigger] = useState('daily')
  const [selectedEvent, setSelectedEvent] = useState('member.cancelled')
  const [runHour, setRunHour] = useState(9)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [step, setStep] = useState(1)

  // First-run state
  const [runStatusMessages, setRunStatusMessages] = useState<string[]>([])
  const [runActions, setRunActions] = useState<RunAction[]>([])

  // AI-generated custom instructions
  const [generatedInstructions, setGeneratedInstructions] = useState<string | null>(null)
  const [generatingInstructions, setGeneratingInstructions] = useState(false)
  const userEditedPrompt = useRef(false)

  const fieldCls = 'w-full text-sm border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 transition-colors'
  const labelCls = 'text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1 block'

  // Guard against React StrictMode double-invoke
  const didFetch = useRef(false)

  // ── Fetch recommendation ────────────────────────────────────────────────────

  const fetchRecommendation = async (force = false) => {
    setPhase('loading')
    setLoadError('')
    try {
      const url = force ? '/api/setup/recommend?force=true' : '/api/setup/recommend'
      const res = await fetch(url, { method: 'POST' })
      if (res.status === 401) {
        router.replace('/')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to analyze (${res.status})`)
      }
      const { recommendation: rec, snapshotSummary, cached, lastSyncedAt: syncedAt } = await res.json()
      const name = snapshotSummary?.accountName || 'Your Gym'
      setRecommendation(rec)
      setAccountName(name)
      setLastSyncedAt(syncedAt ?? null)
      setWasCached(cached ?? false)

      setPhase('recommendation')

      // Fire instruction generation in background so it's ready when user reaches step 2
      generateInstructions(rec, name)
    } catch (err: any) {
      console.error('[setup] recommendation fetch failed:', err)
      setLoadError(err.message)
      setPhase('loading-error')
    }
  }

  const generateInstructions = async (rec: Recommendation, gymName: string) => {
    setGeneratingInstructions(true)
    try {
      const res = await fetch('/api/setup/generate-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentType: rec.agentType,
          agentName: rec.name,
          accountName: gymName,
          stats: rec.stats,
          description: rec.description,
        }),
      })
      if (res.ok) {
        const { instructions } = await res.json()
        setGeneratedInstructions(instructions)
      }
    } catch { /* non-critical — user can type their own */ } finally {
      setGeneratingInstructions(false)
    }
  }

  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    fetchRecommendation()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fill custom instructions when they arrive and user is on step 2
  useEffect(() => {
    if (generatedInstructions && phase === 'build' && step === 2 && !userEditedPrompt.current && !systemPrompt) {
      setSystemPrompt(generatedInstructions)
    }
  }, [generatedInstructions, phase, step]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept recommendation → skip to schedule ────────────────────────────────

  const handleAcceptRecommendation = () => {
    if (!recommendation) return
    userEditedPrompt.current = false
    setAgentName(recommendation.name)
    setDescription(recommendation.description)
    setSystemPrompt(generatedInstructions || '')
    setAgentSkillType(recommendation.agentType)
    setFastPath(true)
    if (recommendation.trigger.mode === 'event' && recommendation.trigger.event) {
      setSelectedTrigger('event')
      setSelectedEvent(recommendation.trigger.event)
    } else if (recommendation.trigger.schedule === 'weekly') {
      setSelectedTrigger('weekly')
    } else {
      setSelectedTrigger('daily')
    }
    setStep(2)
    setPhase('build')
  }

  const handleCustomize = () => {
    if (recommendation) {
      setAgentName(recommendation.name)
      setDescription(recommendation.description)
      setAgentSkillType(recommendation.agentType)
      setFromRecommendation(true)
      if (recommendation.trigger.mode === 'event' && recommendation.trigger.event) {
        setSelectedTrigger('event')
        setSelectedEvent(recommendation.trigger.event)
      } else if (recommendation.trigger.schedule === 'weekly') {
        setSelectedTrigger('weekly')
      } else {
        setSelectedTrigger('daily')
      }
    }
    setFastPath(false)
    setStep(1)
    setPhase('build')
  }

  // ── Create agent ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!agentName.trim()) return
    setCreating(true)
    setCreateError('')

    // Fast path (accepted recommendation): skill file handles agent logic.
    // system_prompt is just optional owner instructions — deploy as-is, no auto-generation.
    if (fastPath && agentSkillType) {
      await deployAgent(systemPrompt.trim())
      return
    }

    // Custom build path: auto-generate a prompt if the user didn't write one.
    if (!systemPrompt.trim()) {
      try {
        const genRes = await fetch('/api/agents/generate-variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: agentName, description }),
        })
        const genData = await genRes.json()
        await deployAgent(
          genRes.ok && genData.variations?.length > 0
            ? genData.variations[0].prompt
            : `You are ${agentName}. ${description}`,
        )
      } catch (err: any) {
        setCreateError(err.message)
        setCreating(false)
      }
      return
    }
    await deployAgent(systemPrompt.trim())
  }

  const deployAgent = async (prompt: string) => {
    try {
      const trigger = TRIGGER_OPTIONS.find(t => t.id === selectedTrigger)!
      // Use recommendation's agentType as skill_type when available — ensures the right
      // skill file is loaded. Fallback: derive from name for custom-built agents.
      const skillType = agentSkillType ||
        agentName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40) ||
        'custom_agent'
      const config = {
        name: agentName,
        description: description.trim(),
        skill_type: skillType,
        system_prompt: prompt || null,
        trigger_mode: trigger.mode === 'manual' ? 'cron' : trigger.mode,
        trigger_event: trigger.mode === 'event' ? selectedEvent : null,
        cron_schedule: trigger.mode === 'cron' ? trigger.schedule : null,
        run_hour: runHour,
        action_type: 'draft_message',
        data_sources: [],
      }
      const res = await fetch('/api/agent-builder/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to create agent')

      // Agent created — show first-run screen instead of auto-redirecting
      setPhase('first-run')
    } catch (err: any) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  // ── Run the agent (SSE stream) ──────────────────────────────────────────────

  const handleRun = async () => {
    setPhase('running')
    setRunStatusMessages([])
    setRunActions([])

    try {
      const res = await fetch('/api/agents/run', { method: 'POST' })
      if (!res.ok || !res.body) {
        router.push('/dashboard')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'status') {
              setRunStatusMessages(prev => [...prev, event.text])
            } else if (event.type === 'done') {
              const actions: RunAction[] = event.result?.output?.actions ?? []
              setRunActions(actions)
              setPhase('results')
            } else if (event.type === 'error') {
              // Don't block the user — just send them to dashboard
              router.push('/dashboard')
            }
          } catch {
            // Malformed SSE line — skip
          }
        }
      }
    } catch {
      router.push('/dashboard')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (phase === 'loading') return <LoadingScreen />

  if (phase === 'loading-error') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8F9FB' }}>
        <div className="text-center max-w-sm w-full">
          <div className="w-12 h-12 flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: '#F3F4F6' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Couldn't analyze your gym's data</h2>
          <p className="text-sm text-gray-500 mb-2">{loadError}</p>
          <p className="text-xs text-gray-400 mb-6">Check the terminal for more details.</p>
          <div className="flex flex-col gap-2">
            <button onClick={fetchRecommendation} className="w-full py-3 text-sm font-bold text-white transition-opacity hover:opacity-80" style={{ backgroundColor: '#0063FF' }}>
              Try again
            </button>
            <button onClick={() => setPhase('build')} className="w-full py-3 text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors" style={{ color: '#6B7280' }}>
              Set up manually instead
            </button>
            <button onClick={() => router.push('/dashboard')} className="text-xs mt-2 transition-colors" style={{ color: '#9CA3AF' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#6B7280')}
              onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'recommendation' && recommendation) {
    return (
      <RecommendationCard
        rec={recommendation}
        accountName={accountName}
        onAccept={handleAcceptRecommendation}
        onCustomize={handleCustomize}
        onSkip={() => router.push('/dashboard')}
        lastSyncedAt={lastSyncedAt}
        wasCached={wasCached}
        onRefresh={() => fetchRecommendation(true)}
      />
    )
  }

  if (phase === 'first-run') {
    return (
      <FirstRunScreen
        agentName={agentName}
        description={description}
        trigger={selectedTrigger}
        runHour={runHour}
        onRun={handleRun}
        onSkip={() => router.push('/dashboard')}
      />
    )
  }

  if (phase === 'running') {
    return <RunningScreen agentName={agentName} statusMessages={runStatusMessages} />
  }

  if (phase === 'results') {
    return (
      <ResultsScreen
        agentName={agentName}
        actions={runActions}
        onContinue={() => router.push('/dashboard')}
      />
    )
  }

  // ── Build flow ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8F9FB' }}>
      <Header onSkip={() => router.push('/dashboard')} />

      <div className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-xl">
          <Progress step={step} />

          {/* Step 1: Build */}
          {step === 1 && (
            <div>
              <div className="mb-6">
                <h1 className="text-xl font-bold text-gray-900 mb-1">Build your gym's first agent</h1>
                <p className="text-sm text-gray-400">Name it, describe what it does for your gym, and let AI write the prompt.</p>
              </div>
              <AgentPromptBuilder
                name={agentName}
                description={description}
                systemPrompt={systemPrompt}
                onNameChange={setAgentName}
                onDescriptionChange={setDescription}
                onSystemPromptChange={setSystemPrompt}
                descriptionPlaceholder="e.g. Find gym members who haven't checked in for 2+ weeks and draft a personal check-in email from the coach."
                autoGenerate={fromRecommendation}
              />
              <div className="mt-6">
                <button
                  onClick={() => setStep(2)}
                  disabled={!agentName.trim()}
                  className="w-full py-3 text-sm font-bold text-white transition-opacity disabled:opacity-40 hover:opacity-80"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  Next: Set a schedule →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Customize */}
          {step === 2 && (
            <div>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Customize</h1>
              <p className="text-sm text-gray-400 mb-6">Fine-tune your agent and set when it runs.</p>

              {/* Agent prompt — shown on fast path (recommendation accepted) */}
              {fastPath && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-1">
                    <label className={labelCls + ' mb-0'}>AGENT PROMPT</label>
                    <button
                      onClick={() => {
                        if (recommendation) {
                          userEditedPrompt.current = false
                          setSystemPrompt('')
                          generateInstructions(recommendation, accountName)
                        }
                      }}
                      disabled={generatingInstructions}
                      className="flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ color: '#0063FF' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                        <path d="m4 16 2.3-6.4a.5.5 0 0 1 .8-.2l3.5 3.5a.5.5 0 0 1-.2.8L4 16"/>
                      </svg>
                      Regenerate
                    </button>
                  </div>
                  <div className="relative">
                    <textarea
                      value={systemPrompt}
                      onChange={e => { setSystemPrompt(e.target.value); userEditedPrompt.current = true }}
                      rows={10}
                      className={fieldCls + ' resize-y text-xs leading-relaxed'}
                      placeholder={generatingInstructions ? '' : `You are a ${agentName} representing ${accountName}...`}
                      disabled={generatingInstructions}
                    />
                    {generatingInstructions && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white border border-gray-200">
                        <div className="flex flex-col items-center gap-2">
                          <span className="w-4 h-4 border-2 border-t-transparent animate-spin" style={{ borderColor: '#0063FF', borderTopColor: 'transparent', borderRadius: '50%' }} />
                          <span className="text-xs text-gray-400">Writing a prompt tailored to {accountName}...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    AI-written from your gym's data. Edit anything — this is your agent's personality.
                  </p>
                </div>
              )}

              {/* Schedule */}
              <label className={labelCls}>SCHEDULE</label>
              <p className="text-xs text-gray-400 mb-3">You can change this anytime from your dashboard.</p>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {TRIGGER_OPTIONS.map(t => {
                  const active = selectedTrigger === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTrigger(t.id)}
                      className="text-left p-4 border transition-colors"
                      style={{ backgroundColor: active ? '#F0F6FF' : 'white', borderColor: active ? '#0063FF' : '#E5E7EB' }}
                    >
                      <p className="text-sm font-bold mb-0.5" style={{ color: active ? '#0063FF' : '#111827' }}>{t.label}</p>
                      <p className="text-xs text-gray-400">{t.description}</p>
                    </button>
                  )
                })}
              </div>

              {(selectedTrigger === 'daily' || selectedTrigger === 'weekly') && (
                <div className="mb-4">
                  <label className={labelCls}>Run at (your gym's local time)</label>
                  <select value={runHour} onChange={e => setRunHour(Number(e.target.value))} className={fieldCls + ' bg-white'}>
                    {Array.from({ length: 24 }, (_, i) => {
                      const label = i === 0 ? '12:00 AM' : i === 12 ? '12:00 PM' : i < 12 ? `${i}:00 AM` : `${i - 12}:00 PM`
                      return <option key={i} value={i}>{label}</option>
                    })}
                  </select>
                </div>
              )}

              {selectedTrigger === 'event' && (
                <div className="mb-4">
                  <label className={labelCls}>Which event triggers this agent?</label>
                  <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)} className={fieldCls + ' bg-white'}>
                    {PUSHPRESS_EVENTS.map(ev => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
                  </select>
                </div>
              )}

              {createError && <p className="text-xs text-red-500 mb-3">{createError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-3 text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                  style={{ color: '#6B7280' }}
                >
                  ← Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-40 hover:opacity-80"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  {creating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating…
                    </span>
                  ) : 'Create agent →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
