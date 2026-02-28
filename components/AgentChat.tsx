'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type AutonomyMode = 'full_auto' | 'semi_auto' | 'turn_based'

interface SessionEvent {
  type: string
  sessionId?: string
  content?: string
  name?: string
  input?: unknown
  result?: unknown
  toolUseId?: string
  reason?: string
  status?: string
  summary?: string
  message?: string
  taskId?: string
  goal?: string
}

interface PendingApproval {
  toolUseId: string
  name: string
  input: Record<string, unknown>
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result' | 'tool_pending'
  content: string
  timestamp: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolUseId?: string
  approved?: boolean | null
}

interface RunSummary {
  id: string
  goal: string
  status: string
  turn_count: number
  cost_cents: number
  created_at: string
  updated_at: string
}

interface AgentChatProps {
  accountId: string
  /** Pre-selected agent ID (optional) */
  agentId?: string
  /** If provided, skip the goal input and start immediately */
  initialGoal?: string
  /** Called when the session creates a task */
  onTaskCreated?: (taskId: string) => void
  /** Called when session completes */
  onComplete?: () => void
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

function relativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function runStatusStyle(status: string): { label: string; color: string } {
  switch (status) {
    case 'active': return { label: 'Working', color: '#F59E0B' }
    case 'waiting_input': return { label: 'Your turn', color: '#22C55E' }
    case 'waiting_approval': return { label: 'Needs approval', color: '#F59E0B' }
    case 'completed': return { label: 'Done', color: '#9CA3AF' }
    case 'failed': return { label: 'Failed', color: '#DC2626' }
    default: return { label: status, color: '#9CA3AF' }
  }
}

function toolDisplayName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Simple markdown renderer ────────────────────────────────────────────────

function InlineMarkdown({ text }: { text: string }): React.ReactElement {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) parts.push(remaining.slice(0, boldMatch.index))
      parts.push(<strong key={key++} className="font-semibold">{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length)
    } else {
      parts.push(remaining)
      break
    }
  }

  return <>{parts}</>
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')

  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) {
          return <p key={i} className="font-semibold text-sm mt-2 mb-0.5"><InlineMarkdown text={line.slice(4)} /></p>
        }
        if (line.startsWith('## ')) {
          return <p key={i} className="font-semibold text-sm mt-2 mb-0.5"><InlineMarkdown text={line.slice(3)} /></p>
        }
        if (line.trim() === '---') {
          return <hr key={i} className="border-gray-100 my-2" />
        }
        if (/^[-*] /.test(line)) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-gray-300 flex-shrink-0">•</span>
              <span><InlineMarkdown text={line.slice(2)} /></span>
            </div>
          )
        }
        const numMatch = line.match(/^(\d+)\.\s(.+)/)
        if (numMatch) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-gray-400 flex-shrink-0">{numMatch[1]}.</span>
              <span><InlineMarkdown text={numMatch[2]} /></span>
            </div>
          )
        }
        if (line.trim() === '') {
          return <div key={i} className="h-1.5" />
        }
        return <p key={i}><InlineMarkdown text={line} /></p>
      })}
    </div>
  )
}

// ── ThinkingDots ─────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-300"
          style={{
            animation: 'dotPulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  )
}

// ── ToolCallBadge ────────────────────────────────────────────────────────────

function ToolCallBadge({ name, input }: { name: string; input?: unknown }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase px-2 py-1 transition-colors hover:opacity-80"
        style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.06)', border: '1px solid rgba(0,99,255,0.12)' }}
      >
        <span style={{ fontSize: 9 }}>{expanded ? '▼' : '▶'}</span>
        {toolDisplayName(name)}
      </button>
      {expanded && input && (
        <pre className="mt-1 text-[10px] text-gray-500 font-mono leading-relaxed px-2 py-1.5 overflow-x-auto"
             style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── ToolResultBadge ──────────────────────────────────────────────────────────

function ToolResultBadge({ name, result }: { name: string; result?: unknown }) {
  const [expanded, setExpanded] = useState(false)
  const r = result as Record<string, unknown> | null
  const isError = r && 'error' in r
  const summary = r
    ? isError
      ? String(r.error)
      : r.status
        ? String(r.status)
        : r.count !== undefined
          ? `${r.count} result${r.count === 1 ? '' : 's'}`
          : 'Done'
    : 'Done'

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 transition-colors"
        style={{
          color: isError ? '#DC2626' : '#059669',
          backgroundColor: isError ? 'rgba(220,38,38,0.05)' : 'rgba(5,150,105,0.05)',
          border: `1px solid ${isError ? 'rgba(220,38,38,0.15)' : 'rgba(5,150,105,0.15)'}`,
        }}
      >
        <span style={{ fontSize: 9 }}>{isError ? '✕' : '✓'}</span>
        {toolDisplayName(name)}: {summary}
      </button>
      {expanded && result && (
        <pre className="mt-1 text-[10px] text-gray-500 font-mono leading-relaxed px-2 py-1.5 overflow-x-auto max-h-40 overflow-y-auto"
             style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── ApprovalCard ─────────────────────────────────────────────────────────────

function ApprovalCard({
  pending,
  onApprove,
  onReject,
  disabled,
}: {
  pending: PendingApproval
  onApprove: () => void
  onReject: () => void
  disabled: boolean
}) {
  const r = pending.input as Record<string, unknown>
  return (
    <div className="my-2 border border-gray-200" style={{ backgroundColor: '#FFFDF5' }}>
      <div className="px-3 py-2 border-b" style={{ borderColor: '#F0ECDF' }}>
        <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#B45309' }}>
          Approval needed
        </p>
        <p className="text-xs font-medium text-gray-800 mt-0.5">{toolDisplayName(pending.name)}</p>
      </div>
      <div className="px-3 py-2">
        {pending.name === 'send_email' && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-gray-500">
              <span className="font-semibold">To:</span> {r.to_name ? `${r.to_name} <${r.to_email}>` : String(r.to_email)}
            </p>
            <p className="text-[10px] text-gray-500"><span className="font-semibold">Subject:</span> {String(r.subject)}</p>
            <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap mt-1">{String(r.body)}</p>
          </div>
        )}
        {pending.name === 'request_input' && (
          <p className="text-sm text-gray-700 leading-relaxed">{String(r.question)}</p>
        )}
        {pending.name !== 'send_email' && pending.name !== 'request_input' && (
          <pre className="text-[10px] text-gray-500 font-mono leading-relaxed overflow-x-auto">
            {JSON.stringify(r, null, 2)}
          </pre>
        )}
      </div>
      <div className="px-3 py-2 flex items-center gap-2 border-t" style={{ borderColor: '#F0ECDF' }}>
        <button
          onClick={onApprove}
          disabled={disabled}
          className="text-xs font-semibold text-white px-3 py-1.5 transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: '#0063FF' }}
        >
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={disabled}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-3 py-1.5 border border-gray-200"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

// ── RunsListView ──────────────────────────────────────────────────────────────

function RunsListView({
  runs,
  loading,
  onSelect,
  onNew,
}: {
  runs: RunSummary[]
  loading: boolean
  onSelect: (run: RunSummary) => void
  onNew: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Conversations</span>
        <button
          onClick={onNew}
          className="text-xs font-semibold text-white px-3 py-1.5 transition-opacity hover:opacity-80"
          style={{ backgroundColor: '#0063FF', borderRadius: 4 }}
        >
          + New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#F8F9FB' }}>
        {loading && (
          <div className="flex items-center justify-center py-12">
            <span className="text-xs text-gray-400">Loading...</span>
          </div>
        )}

        {!loading && runs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 px-6">
            <div className="w-10 h-10 flex items-center justify-center mb-3"
                 style={{ backgroundColor: 'rgba(0,99,255,0.08)' }}>
              <span className="text-lg" role="img" aria-label="chat">&#x1F4AC;</span>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">No conversations yet</p>
            <p className="text-xs text-gray-400 leading-relaxed max-w-xs">
              Start your first conversation to get help from this agent.
            </p>
            <button
              onClick={onNew}
              className="mt-4 text-xs font-semibold text-white px-4 py-2 transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0063FF', borderRadius: 4 }}
            >
              Start a conversation
            </button>
          </div>
        )}

        {!loading && runs.map(run => {
          const { label, color } = runStatusStyle(run.status)
          return (
            <button
              key={run.id}
              onClick={() => onSelect(run)}
              className="w-full text-left px-4 py-3 border-b border-gray-100 bg-white hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-gray-900 font-medium leading-snug flex-1 line-clamp-2">
                  {run.goal || 'Untitled session'}
                </p>
                <span
                  className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 leading-tight"
                  style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}35` }}
                >
                  {label}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-gray-400">{relativeTime(run.created_at)}</span>
                {run.turn_count > 0 && (
                  <span className="text-[10px] text-gray-300">
                    · {run.turn_count} turn{run.turn_count === 1 ? '' : 's'}
                  </span>
                )}
                {run.cost_cents > 0 && (
                  <span className="text-[10px] text-gray-300">
                    · ${(run.cost_cents / 100).toFixed(2)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

// Inject keyframe for thinking dots animation
const KEYFRAME_STYLE = `
@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
`

export default function AgentChat({ accountId, agentId, initialGoal, onTaskCreated, onComplete }: AgentChatProps) {
  const [view, setView] = useState<'list' | 'chat'>(agentId && !initialGoal ? 'list' : 'chat')
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [status, setStatus] = useState<string>('idle') // idle | active | waiting_input | waiting_approval | completed | failed
  // Chat is always turn_based — full_auto/semi_auto are for headless workflows only
  const mode: AutonomyMode = 'turn_based'
  const [inputText, setInputText] = useState('')
  const [goalText, setGoalText] = useState(initialGoal ?? '')
  const [thinking, setThinking] = useState(false)
  const [costCents, setCostCents] = useState(0)
  const [turnCount, setTurnCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Runs management ────────────────────────────────────────────────────────

  const loadRuns = useCallback(async () => {
    if (!agentId) return
    setRunsLoading(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/runs`)
      if (res.ok) {
        const data = await res.json()
        setRuns(data.runs ?? [])
      }
    } finally {
      setRunsLoading(false)
    }
  }, [agentId])

  const loadSession = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/agents/runs/${runId}`)
      if (!res.ok) return
      const data = await res.json()
      setSessionId(data.session.id)
      setMessages(data.messages ?? [])
      setStatus(data.session.status)
      setTurnCount(data.session.turn_count ?? 0)
      setCostCents(data.session.cost_cents ?? 0)
      setPendingApprovals([])
      setInputText('')
      setView('chat')
    } catch {
      // ignore
    }
  }, [])

  const startNew = useCallback(() => {
    setSessionId(null)
    setMessages([])
    setStatus('idle')
    setTurnCount(0)
    setCostCents(0)
    setPendingApprovals([])
    setGoalText('')
    setInputText('')
    setView('chat')
  }, [])

  const goToList = useCallback(() => {
    setView('list')
    loadRuns()
  }, [loadRuns])

  // Load runs when entering list view
  useEffect(() => {
    if (view === 'list') loadRuns()
  }, [view, loadRuns])

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking, pendingApprovals])

  // Auto-start if initialGoal provided
  useEffect(() => {
    if (initialGoal && !sessionId) {
      setView('chat')
      startSession(initialGoal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGoal])

  // ── SSE consumer ───────────────────────────────────────────────────────────

  const consumeSSE = useCallback(async (response: Response) => {
    setThinking(true)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let assistantBuffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: SessionEvent
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          switch (event.type) {
            case 'session_created':
              setSessionId(event.sessionId ?? null)
              break

            case 'message': {
              // Accumulate assistant text — emit as one message when done
              assistantBuffer += (assistantBuffer ? '\n' : '') + (event.content ?? '')
              // Snapshot the buffer value so it isn't clobbered by later events
              // before React commits this state update
              const snapshot = assistantBuffer
              // Update the last assistant message in real-time
              setMessages(prev => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant' && last.id.startsWith('streaming-')) {
                  return [...prev.slice(0, -1), { ...last, content: snapshot }]
                }
                return [...prev, {
                  id: `streaming-${Date.now()}`,
                  role: 'assistant',
                  content: snapshot,
                  timestamp: new Date().toISOString(),
                }]
              })
              break
            }

            case 'tool_call':
              assistantBuffer = '' // reset for next message
              setMessages(prev => [...prev, {
                id: `tc-${Date.now()}-${event.name}`,
                role: 'tool_call',
                content: '',
                toolName: event.name,
                toolInput: event.input,
                timestamp: new Date().toISOString(),
              }])
              break

            case 'tool_result':
              setMessages(prev => [...prev, {
                id: `tr-${Date.now()}-${event.name}`,
                role: 'tool_result',
                content: '',
                toolName: event.name,
                toolResult: event.result,
                timestamp: new Date().toISOString(),
              }])
              // Track task creation
              if (event.name === 'create_task' && (event.result as any)?.taskId) {
                onTaskCreated?.((event.result as any).taskId)
              }
              break

            case 'tool_pending':
              setPendingApprovals(prev => [...prev, {
                toolUseId: event.toolUseId!,
                name: event.name!,
                input: (event.input ?? {}) as Record<string, unknown>,
              }])
              break

            case 'paused':
              setStatus(event.status ?? 'waiting_input')
              assistantBuffer = ''
              break

            case 'done':
              setStatus('completed')
              setMessages(prev => {
                const last = prev[prev.length - 1]
                if (last?.role === 'assistant' && last.id.startsWith('streaming-')) {
                  // Normal path: finalize the streaming message's ID
                  return [...prev.slice(0, -1), { ...last, id: `msg-${Date.now()}` }]
                }
                // Fallback: streaming message was lost — use done.summary directly
                if (event.summary && !prev.some(m => m.role === 'assistant')) {
                  return [...prev, {
                    id: `msg-${Date.now()}`,
                    role: 'assistant' as const,
                    content: event.summary,
                    timestamp: new Date().toISOString(),
                  }]
                }
                return prev
              })
              assistantBuffer = ''
              onComplete?.()
              break

            case 'error':
              setStatus('failed')
              assistantBuffer = ''
              setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: 'system',
                content: `Error: ${event.message}`,
                timestamp: new Date().toISOString(),
              }])
              break
          }
        }
      }
    } finally {
      setThinking(false)
    }
  }, [onTaskCreated, onComplete])

  // ── Actions ────────────────────────────────────────────────────────────────

  const startSession = useCallback(async (goal: string) => {
    setStatus('active')
    setMessages([{
      id: `user-${Date.now()}`,
      role: 'user',
      content: goal,
      timestamp: new Date().toISOString(),
    }])

    try {
      const response = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          goal,
          agentId,
          mode,
          tools: ['data', 'action', 'output', 'learning'],
        }),
      })

      if (!response.ok || !response.body) {
        const errBody = await response.text().catch(() => '')
        setStatus('failed')
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: 'system',
          content: `Failed to start session${errBody ? `: ${errBody.slice(0, 200)}` : ''}`,
          timestamp: new Date().toISOString(),
        }])
        return
      }

      await consumeSSE(response)
    } catch (err: any) {
      setStatus('failed')
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Connection error: ${err?.message ?? 'unknown'}`,
        timestamp: new Date().toISOString(),
      }])
    }
  }, [agentId, mode, consumeSSE])

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId || !content.trim()) return

    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    }])
    setInputText('')
    setStatus('active')

    const response = await fetch('/api/agents/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'message',
        sessionId,
        content: content.trim(),
      }),
    })

    if (!response.ok || !response.body) {
      setStatus('failed')
      return
    }

    await consumeSSE(response)
  }, [sessionId, consumeSSE])

  const handleApproval = useCallback(async (approvals: Record<string, boolean>) => {
    if (!sessionId) return

    setPendingApprovals([])
    setStatus('active')

    const response = await fetch('/api/agents/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        sessionId,
        approvals,
      }),
    })

    if (!response.ok || !response.body) {
      setStatus('failed')
      return
    }

    await consumeSSE(response)
  }, [sessionId, consumeSSE])


  // ── Input handlers ─────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (status === 'idle' && !sessionId) {
        if (goalText.trim()) startSession(goalText.trim())
      } else {
        sendMessage(inputText)
      }
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target
    if (status === 'idle' && !sessionId) {
      setGoalText(el.value)
    } else {
      setInputText(el.value)
    }
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const isInputDisabled = thinking || status === 'active' || status === 'failed'
  const showApprovals = pendingApprovals.length > 0 && status === 'waiting_approval'
  const canSendMessage = status === 'waiting_input' || status === 'waiting_approval'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <style dangerouslySetInnerHTML={{ __html: KEYFRAME_STYLE }} />

      {/* Runs list view */}
      {view === 'list' && agentId ? (
        <RunsListView
          runs={runs}
          loading={runsLoading}
          onSelect={run => loadSession(run.id)}
          onNew={startNew}
        />
      ) : (
        <>
          {/* Header */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {agentId && (
                  <button
                    onClick={goToList}
                    className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors mr-1"
                    title="Back to conversations"
                  >
                    ← Back
                  </button>
                )}
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      status === 'active' || thinking ? '#F59E0B'
                      : status === 'completed' ? '#9CA3AF'
                      : status === 'failed' ? '#DC2626'
                      : status === 'waiting_approval' ? '#F59E0B'
                      : '#22C55E',
                  }}
                />
                <span className="text-sm font-semibold text-gray-900">Agent Session</span>
                {sessionId && (
                  <span className="text-[10px] font-semibold" style={{
                    color:
                      status === 'active' || thinking ? '#F59E0B'
                      : status === 'completed' ? '#9CA3AF'
                      : status === 'failed' ? '#DC2626'
                      : '#22C55E',
                  }}>
                    {status === 'active' || thinking ? 'Working...'
                      : status === 'waiting_input' ? 'Your turn'
                      : status === 'waiting_approval' ? 'Needs approval'
                      : status === 'waiting_event' ? 'Waiting for reply'
                      : status === 'completed' ? 'Done'
                      : status === 'failed' ? 'Failed'
                      : 'Ready'}
                  </span>
                )}
              </div>
              {status === 'completed' && agentId && (
                <button
                  onClick={startNew}
                  className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  New conversation
                </button>
              )}
            </div>
            {sessionId && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                Turn {turnCount}{costCents > 0 ? ` · $${(costCents / 100).toFixed(2)}` : ''}
              </p>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1" style={{ backgroundColor: '#F8F9FB' }}>
            {messages.length === 0 && !sessionId && (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <div className="w-10 h-10 flex items-center justify-center mb-3"
                     style={{ backgroundColor: 'rgba(0,99,255,0.08)' }}>
                  <span className="text-lg" role="img" aria-label="chat">&#x1F916;</span>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">Start an agent session</p>
                <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                  Tell the agent what you want to accomplish. It will gather data, take actions, and learn as it goes.
                </p>
              </div>
            )}

            {messages.map(msg => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end mb-3">
                    <div className="max-w-[75%]">
                      <div className="px-4 py-2.5 text-sm text-white leading-relaxed"
                           style={{ backgroundColor: '#0063FF', borderRadius: '12px 12px 2px 12px' }}>
                        {msg.content}
                      </div>
                      <p className="text-[10px] text-gray-300 mt-1 text-right">{formatTime(msg.timestamp)}</p>
                    </div>
                  </div>
                )
              }

              if (msg.role === 'assistant') {
                return (
                  <div key={msg.id} className="flex justify-start mb-3">
                    <div className="max-w-[85%]">
                      <div className="bg-white border border-gray-100 px-4 py-3 text-sm text-gray-900 leading-relaxed"
                           style={{ borderRadius: '2px 12px 12px 12px' }}>
                        <SimpleMarkdown text={msg.content} />
                      </div>
                      <p className="text-[10px] text-gray-300 mt-1">{formatTime(msg.timestamp)}</p>
                    </div>
                  </div>
                )
              }

              if (msg.role === 'tool_call') {
                return (
                  <div key={msg.id} className="flex justify-start mb-1">
                    <div className="max-w-[80%]">
                      <ToolCallBadge name={msg.toolName!} input={msg.toolInput} />
                    </div>
                  </div>
                )
              }

              if (msg.role === 'tool_result') {
                return (
                  <div key={msg.id} className="flex justify-start mb-1">
                    <div className="max-w-[80%]">
                      <ToolResultBadge name={msg.toolName!} result={msg.toolResult} />
                    </div>
                  </div>
                )
              }

              if (msg.role === 'system') {
                return (
                  <div key={msg.id} className="flex flex-col items-center py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-px w-12 bg-gray-100" />
                      <span className="text-[10px] text-gray-300 text-center">{formatTime(msg.timestamp)}</span>
                      <div className="h-px w-12 bg-gray-100" />
                    </div>
                    <p className="text-xs text-gray-400 mt-1 text-center max-w-sm leading-relaxed">{msg.content}</p>
                  </div>
                )
              }

              return null
            })}

            {/* Pending approvals */}
            {showApprovals && pendingApprovals.map(p => (
              <ApprovalCard
                key={p.toolUseId}
                pending={p}
                onApprove={() => {
                  const approvals = Object.fromEntries(
                    pendingApprovals.map(pa => [pa.toolUseId, pa.toolUseId === p.toolUseId])
                  )
                  handleApproval(approvals)
                }}
                onReject={() => {
                  const approvals = Object.fromEntries(
                    pendingApprovals.map(pa => [pa.toolUseId, pa.toolUseId === p.toolUseId ? false : true])
                  )
                  handleApproval(approvals)
                }}
                disabled={thinking}
              />
            ))}

            {thinking && <ThinkingDots />}

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="flex-shrink-0 border-t border-gray-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={status === 'idle' && !sessionId ? goalText : inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isInputDisabled && !canSendMessage && status !== 'idle'}
                placeholder={
                  status === 'idle' && !sessionId
                    ? 'What should the agent work on?'
                    : canSendMessage
                      ? 'Type a message...'
                      : thinking
                        ? 'Agent is working...'
                        : status === 'completed'
                          ? 'Session complete'
                          : 'Type a message...'
                }
                className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-300 border border-gray-200 px-3 py-2 focus:outline-none focus:border-blue-400 disabled:opacity-50 leading-relaxed"
                style={{ borderRadius: 4, maxHeight: 120, overflowY: 'auto', minHeight: 38 }}
                rows={1}
              />
              <button
                onClick={() => {
                  if (status === 'idle' && !sessionId) {
                    if (goalText.trim()) startSession(goalText.trim())
                  } else {
                    sendMessage(inputText)
                  }
                }}
                disabled={
                  (status === 'idle' && !sessionId && !goalText.trim()) ||
                  (status !== 'idle' && !inputText.trim() && !canSendMessage) ||
                  (thinking)
                }
                className="flex-shrink-0 text-xs font-semibold text-white px-3 py-2 transition-opacity hover:opacity-80 disabled:opacity-30 flex items-center gap-1"
                style={{ backgroundColor: '#0063FF', borderRadius: 4, height: 38 }}
              >
                {status === 'idle' && !sessionId ? 'Start' : 'Send'} &rarr;
              </button>
            </div>
            <p className="text-[10px] text-gray-300 mt-1.5">Enter to {status === 'idle' && !sessionId ? 'start' : 'send'} · Shift+Enter for new line</p>
          </div>
        </>
      )}
    </div>
  )
}
