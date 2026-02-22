'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface ActionCard {
  id: string
  content: {
    memberId: string
    memberName: string
    riskLevel: 'high' | 'medium' | 'low'
    riskReason: string
    draftedMessage: string
    messageSubject: string
    playbookName?: string
    memberEmail: string
    recommendedAction: string
    confidence: number
    insights: string
  }
}

interface Agent {
  id: string
  name: string
  active?: boolean
  skill_type?: string
  last_run_at?: string | null
}

interface RightPanelProps {
  agent: Agent | null
  actions: ActionCard[]
  data: any
  isDemo: boolean
  isSandboxDemo: boolean
  scanning?: boolean
  memberCount?: number
  runResult?: any
  onSelectAction: (action: ActionCard) => void
  onSelectRun: (run: any) => void
  onScanNow?: () => void
}

function RiskDot({ level }: { level: string }) {
  const colors: Record<string, string> = { high: '#EF4444', medium: '#F59E0B', low: '#9CA3AF' }
  return <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 inline-block mt-0.5" style={{ backgroundColor: colors[level] ?? '#9CA3AF' }} />
}

const DEMO_RUNS = [
  { id: 'd1', label: 'Today 1:02am', flagged: 3, playbookName: 'At-Risk Monitor', scanned: 247 },
  { id: 'd2', label: 'Yesterday 1:01am', flagged: 1, playbookName: 'Renewal At-Risk', scanned: 247 },
  { id: 'd3', label: 'Feb 20 1:00am', flagged: 0, playbookName: 'At-Risk Monitor', scanned: 247 },
  { id: 'd4', label: 'Feb 19 1:00am', flagged: 2, playbookName: 'Lapsed Member Win-Back', scanned: 247 },
  { id: 'd5', label: 'Feb 18 1:00am', flagged: 1, playbookName: 'At-Risk Monitor', scanned: 247 },
]

function formatRunDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  if (diffDays === 0) return `Today ${t}`
  if (diffDays === 1) return `Yesterday ${t}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}`
}

export default function RightPanel({
  agent, actions, data, isDemo, isSandboxDemo,
  scanning, memberCount, runResult,
  onSelectAction, onSelectRun, onScanNow,
}: RightPanelProps) {
  const [runHistory, setRunHistory] = useState<any[]>([])

  useEffect(() => {
    if (isDemo) { setRunHistory(DEMO_RUNS); return }
    fetch('/api/agent-runs?limit=8')
      .then(r => r.json())
      .then(d => setRunHistory(d.runs ?? []))
      .catch(() => {})
  }, [isDemo])

  const scopeLabel = agent ? agent.name : 'All agents'

  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* ── NEEDS ATTENTION ── */}
      <div className="px-4 pt-4 pb-3">

        {/* Demo mode callout at top of needs attention */}
        {isSandboxDemo && actions.length > 0 && (
          <div className="mb-3 px-2.5 py-2 flex items-start gap-2" style={{ backgroundColor: '#F4FF78' }}>
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase mb-0.5" style={{ color: '#080808' }}>Demo Mode</p>
              <p className="text-[10px] leading-relaxed" style={{ color: '#080808' }}>
                These are real actions from a live gym. Click any to see the full agent workflow — then try sending one to your inbox.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
            Needs attention{actions.length > 0 ? ` · ${actions.length}` : ''}
          </p>
          {agent && (
            <Link
              href={`/agent-builder?id=${agent.id}`}
              className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors"
            >
              edit
            </Link>
          )}
        </div>

        {/* Scope label when agent selected */}
        {agent && (
          <p className="text-[10px] text-gray-300 mb-2">{scopeLabel}</p>
        )}

        {actions.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-gray-300">Nothing needs attention right now.</p>
          </div>
        ) : (
          <div className="space-y-px -mx-2">
            {actions.map(action => {
              const isYou = action.content?.memberId === 'demo-visitor'
              return (
                <button
                  key={action.id}
                  onClick={() => onSelectAction(action)}
                  className="w-full text-left flex items-start gap-2.5 px-2 py-2.5 transition-colors group"
                  style={isYou ? { backgroundColor: 'rgba(0,99,255,0.04)', borderLeft: '2px solid #0063FF', paddingLeft: 6 } : undefined}
                  onMouseEnter={e => { if (!isYou) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB' }}
                  onMouseLeave={e => { if (!isYou) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
                >
                  <RiskDot level={action.content.riskLevel} />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-900">{action.content.memberName}</span>
                      {isYou && <span className="text-[10px] font-bold tracking-widest uppercase px-1 py-0.5" style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}>you</span>}
                    </span>
                    <span className="text-xs text-gray-400 block leading-snug mt-0.5">{action.content.riskReason}</span>
                    {/* playbook tag removed from list — shown in slide panel instead */}
                  </span>
                  <span className="text-[10px] text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-0.5 transition-colors">→</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Scan result feedback */}
        {runResult?.error && (
          <div className="mt-3 border-l-2 border-red-400 pl-3 py-1">
            <p className="text-xs text-red-600">{runResult.error}</p>
          </div>
        )}
        {runResult?.demoMessage && (
          <div className="mt-3 border-l-2 pl-3 py-1" style={{ borderColor: '#0063FF' }}>
            <p className="text-xs text-gray-600">{runResult.demoMessage}</p>
            <a href="/login" className="text-xs font-semibold underline underline-offset-2 mt-1 inline-block" style={{ color: '#0063FF' }}>
              Connect your gym →
            </a>
          </div>
        )}
        {runResult?.output && !runResult.error && (
          <div className="mt-3 border-l-2 border-green-400 pl-3 py-1">
            <p className="text-xs text-gray-600">{runResult.output.summary}</p>
          </div>
        )}

        {/* Scan now */}
        {onScanNow && !scanning && (
          <button
            onClick={onScanNow}
            className="mt-3 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            scan now →
          </button>
        )}
      </div>

      {/* ── RUN HISTORY ── */}
      <div className="border-t border-gray-100 px-4 py-4">
        <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-2">Run history</p>
        <div className="space-y-0.5">
          {isDemo ? (
            DEMO_RUNS.map((run, i) => (
              <button
                key={i}
                onClick={() => onSelectRun(run)}
                className="w-full flex items-center justify-between py-1.5 text-xs hover:bg-gray-50 -mx-2 px-2 transition-colors group"
              >
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-gray-500 group-hover:text-gray-700 transition-colors">{run.label}</span>
                  {run.playbookName && <span className="text-[10px] font-semibold tracking-wide uppercase mt-0.5" style={{ color: '#0063FF' }}>{run.playbookName}</span>}
                </div>
                <span className={`font-medium flex-shrink-0 ${run.flagged > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                  {run.flagged > 0 ? `${run.flagged} flagged` : '—'}
                </span>
              </button>
            ))
          ) : runHistory.length > 0 ? (
            runHistory.map((run: any) => {
              const flagged = run.actions_taken ?? run.messages_sent ?? 0
              const label = run.completed_at ? formatRunDate(run.completed_at) : '—'
              const playbookName = run.skill_name ?? (run.skill_type ? run.skill_type.replace(/_/g, ' ') : null)
              return (
                <button
                  key={run.id}
                  onClick={() => onSelectRun(run)}
                  className="w-full flex items-center justify-between py-1.5 text-xs hover:bg-gray-50 -mx-2 px-2 transition-colors group"
                >
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-gray-500 group-hover:text-gray-700 transition-colors">{label}</span>
                    {playbookName && <span className="text-[10px] font-semibold tracking-wide uppercase mt-0.5" style={{ color: '#0063FF' }}>{playbookName}</span>}
                  </div>
                  <span className={`font-medium flex-shrink-0 ${flagged > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                    {flagged > 0 ? `${flagged} flagged` : '—'}
                  </span>
                </button>
              )
            })
          ) : (
            <p className="text-xs text-gray-400">No runs yet.</p>
          )}
        </div>
      </div>

    </div>
  )
}
