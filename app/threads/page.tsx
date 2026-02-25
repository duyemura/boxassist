'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentDecision {
  action: 'reply' | 'close' | 'escalate' | 'reopen'
  reply?: string
  newGoal?: string
  scoreReason: string
  outcomeScore: number
  resolved: boolean
}

interface Message {
  id: string
  action_id: string
  role: 'outbound' | 'inbound' | 'agent_decision'
  text: string
  created_at: string
  member_name: string
  _decision?: AgentDecision | null
}

interface Thread {
  action_id: string
  member_name: string
  messages: Message[]
  started_at: string
  last_at: string
  resolved: boolean
  needs_review: boolean
  action_db_id?: string
  // stats derived client-side
  turnCount?: number
  finalScore?: number | null
  finalAction?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).toLowerCase()
}

function getThreadStats(thread: Thread) {
  const decisions = thread.messages.filter(m => m.role === 'agent_decision' && m._decision)
  const lastDecision = decisions[decisions.length - 1]?._decision
  const turnCount = thread.messages.filter(m => m.role === 'inbound').length
  return {
    turnCount,
    finalScore: lastDecision?.outcomeScore ?? null,
    finalAction: lastDecision?.action ?? null,
  }
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null
  const color = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626'
  const bg = score >= 70 ? 'rgba(22,163,74,0.08)' : score >= 40 ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)'
  return (
    <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color, backgroundColor: bg }}>
      {score}
    </span>
  )
}

function ActionBadge({ action }: { action: string | null }) {
  if (!action) return null
  const map: Record<string, { label: string; color: string; bg: string }> = {
    close:    { label: 'closed',    color: '#16A34A', bg: 'rgba(22,163,74,0.08)' },
    reply:    { label: 'replied',   color: '#0063FF', bg: 'rgba(0,99,255,0.08)' },
    escalate: { label: 'escalated', color: '#D97706', bg: 'rgba(217,119,6,0.08)' },
    reopen:   { label: 'reopened',  color: '#7C3AED', bg: 'rgba(124,58,237,0.08)' },
  }
  const style = map[action] ?? { label: action, color: '#6B7280', bg: 'rgba(107,114,128,0.08)' }
  return (
    <span className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded" style={{ color: style.color, backgroundColor: style.bg }}>
      {style.label}
    </span>
  )
}

// ── Decision card — the main insight block ────────────────────────────────────

function DecisionCard({ decision, turnIndex }: { decision: AgentDecision; turnIndex: number }) {
  const actionColors: Record<string, string> = {
    reply: '#0063FF',
    close: '#16A34A',
    escalate: '#D97706',
    reopen: '#7C3AED',
  }
  const color = actionColors[decision.action] ?? '#6B7280'

  const scoreColor = decision.outcomeScore >= 70
    ? '#16A34A'
    : decision.outcomeScore >= 40
      ? '#D97706'
      : '#DC2626'

  return (
    <div className="mx-4 my-1 rounded border border-dashed" style={{ borderColor: `${color}40`, backgroundColor: `${color}06` }}>
      <div className="px-3 py-2">

        {/* Header row */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color }}>
            AI · turn {turnIndex}
          </span>
          <ActionBadge action={decision.action} />
          <span className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-gray-400">confidence</span>
            <span className="text-xs font-bold" style={{ color: scoreColor }}>{decision.outcomeScore}</span>
            <span className="text-[10px] text-gray-300">/100</span>
          </span>
        </div>

        {/* Score bar */}
        <div className="w-full h-1 bg-gray-100 rounded-full mb-2 overflow-hidden">
          <div
            className="h-1 rounded-full transition-all"
            style={{ width: `${decision.outcomeScore}%`, backgroundColor: scoreColor }}
          />
        </div>

        {/* Reasoning */}
        <p className="text-xs text-gray-600 leading-relaxed mb-1.5">
          <span className="text-gray-400 font-medium">Reasoning: </span>
          {decision.scoreReason}
        </p>

        {/* Next step */}
        {decision.action === 'reply' && decision.reply && (
          <p className="text-xs text-gray-400 leading-relaxed">
            <span className="font-medium">Next step: </span>
            Send reply → &ldquo;{decision.reply.slice(0, 80)}{decision.reply.length > 80 ? '…' : ''}&rdquo;
          </p>
        )}
        {decision.action === 'close' && (
          <p className="text-xs text-gray-400">
            <span className="font-medium">Next step: </span>
            Close thread · goal {decision.resolved ? 'achieved' : 'not fully achieved'}
          </p>
        )}
        {decision.action === 'escalate' && (
          <p className="text-xs text-gray-400">
            <span className="font-medium">Next step: </span>
            Flag for human review · pause automation
          </p>
        )}
        {decision.action === 'reopen' && decision.newGoal && (
          <p className="text-xs text-gray-400">
            <span className="font-medium">Next step: </span>
            Reopen → {decision.newGoal}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Thread detail panel ───────────────────────────────────────────────────────

function ThreadDetail({ thread }: { thread: Thread }) {
  const { turnCount, finalScore, finalAction } = getThreadStats(thread)

  // Interleave messages with decisions shown inline after each inbound
  let turnIdx = 0
  const rendered: React.ReactNode[] = []

  for (let i = 0; i < thread.messages.length; i++) {
    const msg = thread.messages[i]

    if (msg.role === 'outbound') {
      rendered.push(
        <div key={msg.id} className="flex justify-end px-4 py-1">
          <div className="max-w-[75%]">
            <div className="bg-blue-600 text-white text-xs px-3 py-2 rounded-lg rounded-br-sm leading-relaxed">
              {msg.text}
            </div>
            <p className="text-[10px] text-gray-300 text-right mt-0.5">{formatTime(msg.created_at)}</p>
          </div>
        </div>
      )
    } else if (msg.role === 'inbound') {
      rendered.push(
        <div key={msg.id} className="flex justify-start px-4 py-1">
          <div className="max-w-[75%]">
            <div className="bg-gray-100 text-gray-900 text-xs px-3 py-2 rounded-lg rounded-bl-sm leading-relaxed">
              {msg.text}
            </div>
            <p className="text-[10px] text-gray-300 mt-0.5">{formatTime(msg.created_at)}</p>
          </div>
        </div>
      )
    } else if (msg.role === 'agent_decision' && msg._decision) {
      turnIdx++
      rendered.push(
        <DecisionCard key={msg.id} decision={msg._decision} turnIndex={turnIdx} />
      )
    }
  }

  return (
    <div className="flex flex-col h-full">

      {/* Thread header */}
      <div className="px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{thread.member_name}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {turnCount} {turnCount === 1 ? 'reply' : 'replies'} · started {timeAgo(thread.started_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {finalScore !== null && <ScoreBadge score={finalScore} />}
            {finalAction && <ActionBadge action={finalAction} />}
            {thread.resolved && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: '#16A34A', backgroundColor: 'rgba(22,163,74,0.08)' }}>
                ✓ resolved
              </span>
            )}
            {thread.needs_review && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: '#D97706', backgroundColor: 'rgba(217,119,6,0.08)' }}>
                ⚠ review
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4">
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-blue-600 inline-block" /> Coach (outbound)
        </span>
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-gray-200 inline-block" /> Member (inbound)
        </span>
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm border border-dashed border-blue-300 inline-block" /> AI evaluation
        </span>
      </div>

      {/* Messages + decisions */}
      <div className="flex-1 overflow-y-auto py-3 space-y-0.5">
        {rendered}

        {/* Final state if resolved */}
        {thread.resolved && (
          <div className="flex justify-center py-4">
            <span className="text-[10px] text-gray-400 px-3 py-1 bg-gray-100 rounded-full">
              ✓ Thread closed · goal {(finalScore ?? 0) >= 60 ? 'achieved' : 'not fully achieved'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ThreadsPage() {
  const router = useRouter()
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved' | 'escalated'>('all')
  const [searchEmail, setSearchEmail] = useState('')
  const [debouncedEmail, setDebouncedEmail] = useState('')

  // Debounce email search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedEmail(searchEmail), 400)
    return () => clearTimeout(t)
  }, [searchEmail])

  const fetchThreads = useCallback(async () => {
    setLoading(true)
    try {
      const url = debouncedEmail
        ? `/api/conversations/by-email?email=${encodeURIComponent(debouncedEmail)}`
        : '/api/conversations/all'
      const res = await fetch(url)
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json()
      setThreads(data.threads ?? [])
      // Auto-select first thread
      if (data.threads?.length && !selectedId) {
        setSelectedId(data.threads[0].action_id)
      }
    } catch {}
    setLoading(false)
  }, [debouncedEmail, router, selectedId])

  useEffect(() => { fetchThreads() }, [fetchThreads])

  const filtered = threads.filter(t => {
    if (filter === 'open') return !t.resolved && !t.needs_review
    if (filter === 'resolved') return t.resolved
    if (filter === 'escalated') return t.needs_review
    return true
  })

  const selectedThread = filtered.find(t => t.action_id === selectedId) ?? filtered[0] ?? null

  // Add derived stats
  const enriched = filtered.map(t => ({ ...t, ...getThreadStats(t) }))
  const selectedEnriched = enriched.find(t => t.action_id === selectedThread?.action_id) ?? null

  // Summary stats
  const total = threads.length
  const resolved = threads.filter(t => t.resolved).length
  const escalated = threads.filter(t => t.needs_review).length
  const avgScore = (() => {
    const scores = threads.map(t => getThreadStats(t).finalScore).filter((s): s is number => s !== null)
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  })()

  return (
    <DashboardShell>
      <div className="h-full flex flex-col">

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold" style={{ color: '#080808' }}>Threads</h1>
          </div>
          <button onClick={fetchThreads} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            ↻ refresh
          </button>
        </div>

        {/* ── Summary bar ── */}
        <div className="border-b border-gray-100 px-6 py-2 flex items-center gap-6">
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-gray-900">{total}</span> threads
          </div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-gray-900">{resolved}</span> resolved
          </div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold" style={{ color: '#D97706' }}>{escalated}</span> escalated
          </div>
          {avgScore !== null && (
            <div className="text-xs text-gray-500 flex items-center gap-1">
              avg score <ScoreBadge score={avgScore} />
            </div>
          )}
          <div className="ml-auto">
            <input
              type="email"
              placeholder="filter by member email…"
              value={searchEmail}
              onChange={e => setSearchEmail(e.target.value)}
              className="text-xs border border-gray-200 px-2 py-1 w-52 focus:outline-none focus:border-blue-400 text-gray-700 placeholder-gray-300"
            />
          </div>
        </div>

        {/* ── Body: list + detail ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: thread list */}
          <div className="w-72 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">

            {/* Filter tabs */}
            <div className="flex border-b border-gray-100">
              {(['all', 'open', 'resolved', 'escalated'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="flex-1 text-[10px] font-semibold tracking-widest uppercase py-2 transition-colors"
                  style={{
                    color: filter === f ? '#0063FF' : '#9CA3AF',
                    borderBottom: filter === f ? '2px solid #0063FF' : '2px solid transparent',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <p className="text-xs text-gray-300">Loading…</p>
                </div>
              ) : enriched.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <p className="text-xs text-gray-400">No threads yet.</p>
                  <p className="text-xs text-gray-300 mt-1">Send a message from the dashboard to start one.</p>
                </div>
              ) : (
                enriched.map(thread => {
                  const isSelected = selectedId === thread.action_id
                  return (
                    <button
                      key={thread.action_id}
                      onClick={() => setSelectedId(thread.action_id)}
                      className="w-full text-left px-3 py-3 border-b border-gray-50 transition-colors"
                      style={{
                        backgroundColor: isSelected ? 'rgba(0,99,255,0.04)' : undefined,
                        borderLeft: isSelected ? '2px solid #0063FF' : '2px solid transparent',
                      }}
                    >
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <span className="text-xs font-semibold text-gray-900 truncate">{thread.member_name}</span>
                        <span className="text-[10px] text-gray-300 flex-shrink-0">{timeAgo(thread.last_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        {thread.resolved && (
                          <span className="text-[10px]" style={{ color: '#16A34A' }}>✓</span>
                        )}
                        {thread.needs_review && (
                          <span className="text-[10px]" style={{ color: '#D97706' }}>⚠</span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {thread.turnCount} {thread.turnCount === 1 ? 'reply' : 'replies'}
                        </span>
                        {thread.finalAction && <ActionBadge action={thread.finalAction} />}
                        {thread.finalScore !== null && <ScoreBadge score={thread.finalScore} />}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Right: thread detail */}
          <div className="flex-1 overflow-hidden bg-white">
            {selectedEnriched ? (
              <ThreadDetail thread={selectedEnriched} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center px-8">
                  <p className="text-sm text-gray-500 font-medium mb-1">No thread selected</p>
                  <p className="text-xs text-gray-400">Pick a thread from the left to see the full conversation and AI reasoning.</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </DashboardShell>
  )
}
