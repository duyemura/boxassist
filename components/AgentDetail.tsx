'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

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
  }
  approved: boolean | null
  dismissed: boolean | null
}

interface Agent {
  id: string
  name: string
  active?: boolean
  skill_type?: string
  last_run_at?: string | null
  run_count?: number
  schedule?: string
}

interface AgentDetailProps {
  agent: Agent | null
  actions: ActionCard[]
  onSelectAction: (action: ActionCard) => void
  onSelectRun?: (run: any) => void
  isDemo: boolean
  onScanNow?: () => void
  scanning?: boolean
  memberCount?: number
  runResult?: any
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function RiskIndicator({ level }: { level: 'high' | 'medium' | 'low' }) {
  const colors: Record<string, string> = {
    high: '#EF4444',
    medium: '#F59E0B',
    low: '#9CA3AF',
  }
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: colors[level] }}
      title={`${level} risk`}
    />
  )
}

const DEMO_RUN_HISTORY = [
  { label: 'Today 1:02am', scanned: 31, flagged: 3, value: '$130 est.', cost: '$0.24' },
  { label: 'Yesterday 1:01am', scanned: 31, flagged: 1, value: '$130 est.', cost: '$0.22' },
  { label: 'Feb 20 1:00am', scanned: 31, flagged: 0, value: '—', cost: '$0.18' },
  { label: 'Feb 19 1:00am', scanned: 31, flagged: 2, value: '$260 est.', cost: '$0.22' },
  { label: 'Feb 18 1:00am', scanned: 31, flagged: 1, value: '$130 est.', cost: '$0.20' },
]

function formatRunDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

  if (diffDays === 0) return `Today ${timeStr}`
  if (diffDays === 1) return `Yesterday ${timeStr}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${timeStr}`
}

function getAgentScheduleLabel(agent: Agent): string {
  if (agent.schedule) return agent.schedule
  return 'daily @ 1am'
}

function getAgentDescription(agent: Agent): string {
  const map: Record<string, string> = {
    at_risk_detector: 'Scans your members daily. Finds who\'s drifting, drafts a personal message, asks if you want to send it.',
    member_pulse: 'Scans members daily and finds who\'s at risk of canceling before they do.',
    lead_catcher: 'Responds to new leads within minutes, drafting personal messages in your voice.',
    renewal_guard: 'Watches for upcoming renewals and flags members at risk of not renewing.',
    win_back: 'Reaches out to members who have recently cancelled with genuine win-back messages.',
  }
  return map[agent.skill_type ?? ''] ?? 'Monitors your gym and takes action when needed.'
}

export default function AgentDetail({
  agent,
  actions,
  onSelectAction,
  onSelectRun,
  isDemo,
  onScanNow,
  scanning,
  memberCount,
  runResult,
}: AgentDetailProps) {
  const [membershipValue, setMembershipValue] = useState(130)
  const [editingValue, setEditingValue] = useState(false)
  const [draftValue, setDraftValue] = useState('130')
  const valueInputRef = useRef<HTMLInputElement>(null)
  const [roiStats, setRoiStats] = useState<any>(null)
  const [runHistory, setRunHistory] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/stats/roi').then(r => r.json()).then(setRoiStats).catch(() => {})
    fetch('/api/agent-runs?limit=5').then(r => r.json()).then(d => setRunHistory(d.runs ?? [])).catch(() => {})
  }, [])

  if (!agent) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-xs text-gray-400">Select an agent to see details</p>
      </div>
    )
  }

  const schedule = getAgentScheduleLabel(agent)
  const description = getAgentDescription(agent)
  const lastRunText = agent.last_run_at ? `last ran ${timeAgo(agent.last_run_at)}` : 'never run'
  const isRunning = agent.active

  // ROI numbers — use real data if available, fall back to local estimate
  const actionsWithValue = actions.length
  const localTotalValue = actionsWithValue * membershipValue
  const agentCost = roiStats ? parseFloat(roiStats.totalBilledUsd) : 1.20
  const roi = roiStats ? roiStats.roi : (agentCost > 0 ? Math.round(localTotalValue / agentCost) : 0)

  return (
    <div className="flex flex-col divide-y divide-gray-100">

      {/* A. Agent header */}
      <div className="px-4 py-4">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900">{agent.name}</h2>
          <Link
            href={`/agent-builder?id=${agent.id}`}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors ml-2 flex-shrink-0"
          >
            edit
          </Link>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRunning ? 'bg-green-400' : 'bg-gray-200'}`}
          />
          <span className="text-xs text-gray-400">
            {isRunning ? 'Running' : 'Idle'} · {schedule}
          </span>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
        {agent.last_run_at && (
          <p className="text-xs text-gray-300 mt-1.5">
            {lastRunText} · {agent.run_count ?? 0} scans
          </p>
        )}
      </div>

      {/* B. Scan now / run result feedback */}
      {(onScanNow || runResult) && (
        <div className="px-4 py-3">
          {runResult?.error && (
            <div className="border-l-2 border-red-400 pl-3 py-1 mb-2">
              <p className="text-xs text-red-600">{runResult.error}</p>
            </div>
          )}
          {runResult?.demoMessage && (
            <div className="border-l-2 pl-3 py-1 mb-2" style={{ borderColor: '#0063FF' }}>
              <p className="text-xs text-gray-600">{runResult.demoMessage}</p>
              <a href="/login" className="text-xs font-semibold underline underline-offset-2 mt-1 inline-block" style={{ color: '#0063FF' }}>
                Connect your gym &rarr;
              </a>
            </div>
          )}
          {runResult?.output && !runResult.error && (
            <div className="border-l-2 border-green-400 pl-3 py-1 mb-2">
              <p className="text-xs text-gray-600">{runResult.output.summary}</p>
            </div>
          )}
          {onScanNow && (
            <button
              onClick={onScanNow}
              disabled={scanning}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
            >
              {scanning ? 'scanning…' : 'scan now →'}
            </button>
          )}
        </div>
      )}

      {/* C. Needs attention */}
      <div className="px-4 py-4">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">
          Needs attention {actions.length > 0 && `(${actions.length})`}
        </p>
        {actions.length === 0 ? (
          <p className="text-xs text-gray-400">Nothing needs attention right now.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto -mx-1">
            {actions.map(action => (
              <button
                key={action.id}
                onClick={() => onSelectAction(action)}
                className="w-full text-left flex items-center gap-3 px-1 py-2 hover:bg-gray-50 transition-colors group"
              >
                <RiskIndicator level={action.content.riskLevel} />
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-gray-900">{action.content.memberName}</span>
                  <span className="text-gray-300 text-xs mx-1">·</span>
                  <span className="text-xs text-gray-400 truncate">{action.content.riskReason}</span>
                </span>
                <span className="text-xs text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0">
                  &rarr;
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* D. Run history — compact: date/time left, flagged count right */}
      <div className="px-4 py-4">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-2">Run history</p>
        {isDemo ? (
          <div className="space-y-0.5">
            {DEMO_RUN_HISTORY.map((run, i) => (
              <button
                key={i}
                onClick={() => onSelectRun?.(run)}
                className="w-full flex items-center justify-between py-1.5 text-xs hover:bg-gray-50 -mx-2 px-2 transition-colors group"
              >
                <span className="text-gray-500 group-hover:text-gray-700 transition-colors">{run.label}</span>
                <span className={`font-medium flex-shrink-0 ${run.flagged > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                  {run.flagged > 0 ? `${run.flagged} flagged` : '—'}
                </span>
              </button>
            ))}
          </div>
        ) : runHistory.length > 0 ? (
          <div className="space-y-0.5">
            {runHistory.map((run: any) => {
              const flagged = run.actions_taken ?? run.messages_sent ?? 0
              const label = run.completed_at ? formatRunDate(run.completed_at) : '—'
              return (
                <button
                  key={run.id}
                  onClick={() => onSelectRun?.(run)}
                  className="w-full flex items-center justify-between py-1.5 text-xs hover:bg-gray-50 -mx-2 px-2 transition-colors group"
                >
                  <span className="text-gray-500 group-hover:text-gray-700 transition-colors">{label}</span>
                  <span className={`font-medium flex-shrink-0 ${flagged > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                    {flagged > 0 ? `${flagged} flagged` : '—'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : agent.last_run_at ? (
          <p className="text-xs text-gray-400">Last ran {timeAgo(agent.last_run_at)}</p>
        ) : (
          <p className="text-xs text-gray-400">No runs yet.</p>
        )}
      </div>

      {/* E. ROI */}
      <div className="px-4 py-4">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">ROI this month</p>
        <div className="space-y-1.5 text-xs">
          {/* Messages sent */}
          <div className="flex justify-between">
            <span className="text-gray-500">Messages sent</span>
            <span className="text-gray-900 font-medium">
              {isDemo ? '31' : roiStats ? String(roiStats.totalMessages) : String(actions.length)}
            </span>
          </div>
          {/* Actions attributed */}
          <div className="flex justify-between">
            <span className="text-gray-500">Actions attributed</span>
            <span className="text-gray-900 font-medium">
              {isDemo ? '3' : roiStats ? String(roiStats.membersSaved) : '—'}
            </span>
          </div>
          {/* Est. value retained */}
          <div className="flex justify-between">
            <span className="text-gray-500">Est. value retained</span>
            <span className="text-gray-900 font-medium">
              {isDemo
                ? '$390'
                : roiStats
                  ? `$${Math.round(parseFloat(roiStats.revenueRetained))}`
                  : localTotalValue > 0 ? `$${localTotalValue}` : '—'}
            </span>
          </div>
          {/* Agent cost */}
          <div className="flex justify-between">
            <span className="text-gray-500">Agent cost</span>
            <span className="text-gray-900 font-medium">
              {isDemo ? '$1.20' : `$${agentCost.toFixed(2)}`}
            </span>
          </div>
          {/* ROI */}
          <div className="border-t border-gray-100 pt-1.5 flex justify-between">
            <span className="text-gray-500">ROI</span>
            <span
              className="font-semibold"
              style={{ color: roi > 0 ? '#22c55e' : '#9CA3AF' }}
            >
              {isDemo ? '325x' : roi > 0 ? `${roi}x` : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-400">Avg membership value</span>
          {editingValue ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">$</span>
              <input
                ref={valueInputRef}
                type="number"
                value={draftValue}
                onChange={e => setDraftValue(e.target.value)}
                className="w-16 text-xs border border-gray-200 px-1.5 py-0.5 text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const v = parseInt(draftValue)
                    if (!isNaN(v) && v > 0) setMembershipValue(v)
                    setEditingValue(false)
                  }
                  if (e.key === 'Escape') {
                    setDraftValue(String(membershipValue))
                    setEditingValue(false)
                  }
                }}
                onBlur={() => {
                  const v = parseInt(draftValue)
                  if (!isNaN(v) && v > 0) setMembershipValue(v)
                  setEditingValue(false)
                }}
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => {
                setDraftValue(String(membershipValue))
                setEditingValue(true)
              }}
              className="text-xs text-gray-900 font-medium hover:text-gray-600 transition-colors"
            >
              ${membershipValue}
            </button>
          )}
          {!editingValue && (
            <button
              onClick={() => {
                setDraftValue(String(membershipValue))
                setEditingValue(true)
              }}
              className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
            >
              edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
