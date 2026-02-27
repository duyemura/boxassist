'use client'

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import type { GMChatMessage } from '@/lib/gmChat'
import AnalysisProgress from '@/components/AnalysisProgress'

export interface GMChatHandle {
  addMessage: (msg: Omit<GMChatMessage, 'id'>) => void
  updateLastMessage: (content: string) => void
  sendMessage: (text: string) => void
}

// ── Demo seed data ────────────────────────────────────────────────────────────

const DEMO_HISTORY: GMChatMessage[] = [
  {
    id: 'demo-sys-1',
    role: 'system_event',
    content: 'GM ran analysis on PushPress East. Found at-risk members, tasks added to To-Do.',
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  },
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuickAction {
  label: string
  onAction: () => void
}

export interface GMChatProps {
  accountId: string
  isDemo: boolean
  agentName?: string
  initialHistory?: GMChatMessage[]
  onTaskCreated?: (taskId: string) => void
  onRunAnalysis?: () => void
  quickActions?: QuickAction[]
  analysisProgress?: { steps: string[]; isRunning: boolean; onDismiss?: () => void }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  if (diffDays === 0) return `Today ${t}`
  if (diffDays === 1) return `Yesterday ${t}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}`
}

// ── ThinkingDots ──────────────────────────────────────────────────────────────

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

// ── DataTable ─────────────────────────────────────────────────────────────────

function DataTable({ data }: { data: Array<Record<string, unknown>> }) {
  if (!data || data.length === 0) return null
  const columns = Object.keys(data[0])
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col}
                className="text-left py-1.5 px-2 text-gray-400 font-medium border-b border-gray-100 capitalize"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
              {columns.map(col => (
                <td key={col} className="py-1.5 px-2 text-gray-700 border-b border-gray-50">
                  {String(row[col] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: GMChatMessage }) {
  if (msg.role === 'system_event') {
    return (
      <div className="flex flex-col items-center py-3">
        <div className="flex items-center gap-2">
          <div className="h-px w-12 bg-gray-100" />
          <span className="text-[10px] text-gray-300 text-center">
            {msg.createdAt ? formatTime(msg.createdAt) : ''}
          </span>
          <div className="h-px w-12 bg-gray-100" />
        </div>
        <p className="text-[11px] text-gray-400 mt-1 text-center max-w-xs">{msg.content}</p>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[75%]">
          <div
            className="px-4 py-2.5 text-sm text-white leading-relaxed"
            style={{ backgroundColor: '#0063FF', borderRadius: '12px 12px 2px 12px' }}
          >
            {msg.content}
          </div>
          {msg.createdAt && (
            <p className="text-[10px] text-gray-300 mt-1 text-right">{formatTime(msg.createdAt)}</p>
          )}
        </div>
      </div>
    )
  }

  // assistant
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%]">
        <div
          className="bg-white border border-gray-100 px-4 py-3 text-sm text-gray-900 leading-relaxed"
          style={{ borderRadius: '2px 12px 12px 12px' }}
        >
          {/* Split content on \n to render line breaks */}
          {msg.content.split('\n').map((line, i) => (
            <span key={i}>
              {line}
              {i < msg.content.split('\n').length - 1 && <br />}
            </span>
          ))}
          {msg.data && msg.data.length > 0 && (
            <DataTable data={msg.data} />
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {msg.createdAt && (
            <p className="text-[10px] text-gray-300">{formatTime(msg.createdAt)}</p>
          )}
          {msg.route && (
            <span className="text-[9px] text-gray-200 uppercase tracking-wide">
              {msg.route.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main GMChat component ─────────────────────────────────────────────────────

const GMChat = forwardRef<GMChatHandle, GMChatProps>(function GMChat({
  accountId,
  isDemo,
  agentName,
  initialHistory,
  onTaskCreated,
  onRunAnalysis,
  quickActions,
  analysisProgress,
}, ref) {
  const [messages, setMessages] = useState<GMChatMessage[]>(
    initialHistory ?? (isDemo ? DEMO_HISTORY : []),
  )

  // Ref to always hold the latest sendMessage — avoids stale closure in useImperativeHandle
  const sendMessageRef = useRef<(text: string) => void>(() => {})

  useImperativeHandle(ref, () => ({
    addMessage: (msg) => {
      setMessages(prev => [...prev, { id: `ext-${Date.now()}`, ...msg }])
    },
    updateLastMessage: (content: string) => {
      setMessages(prev => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        return [...prev.slice(0, -1), { ...last, content }]
      })
    },
    sendMessage: (text: string) => sendMessageRef.current(text),
  }))
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputBarRef = useRef<HTMLDivElement>(null)

  // Scroll so the input bar is visible at the bottom of the viewport
  // Use scrollIntoView on the input bar rather than the message list bottom
  // so we don't pull past the marketing/footer content in demo mode
  useEffect(() => {
    inputBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isThinking])

  const sendMessage = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim()
    if (!text || isThinking) return

    const userMsg: GMChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsThinking(true)

    try {
      const res = await fetch('/api/gm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          accountId,
          conversationHistory: messages.slice(-10),
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const assistantMsg: GMChatMessage = {
        id: `reply-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        route: data.route,
        actionType: data.actionType,
        data: data.data,
        taskId: data.taskId,
        thinkingSteps: data.thinkingSteps,
        createdAt: new Date().toISOString(),
      }

      setMessages(prev => [...prev, assistantMsg])

      if (data.taskId && onTaskCreated) onTaskCreated(data.taskId)
      if (data.route === 'run_analysis' && onRunAnalysis) onRunAnalysis()
    } catch {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        createdAt: new Date().toISOString(),
      }])
    } finally {
      setIsThinking(false)
    }
  }, [input, isThinking, accountId, messages, onTaskCreated, onRunAnalysis])

  // Keep ref in sync so useImperativeHandle always calls the latest version
  useEffect(() => { sendMessageRef.current = sendMessage }, [sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#22C55E' }} />
          <span className="text-sm font-semibold text-gray-900">{agentName || 'GM Agent'}</span>
          <span className="text-[10px] font-semibold" style={{ color: '#22C55E' }}>Active</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">Ask anything about your business</p>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div
              className="w-10 h-10 flex items-center justify-center mb-3"
              style={{ backgroundColor: 'rgba(0,99,255,0.08)' }}
            >
              <span className="text-lg">💬</span>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Ask me anything</p>
            <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
              Who's at churn risk? Revenue this month? Draft a message for a member?
            </p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id ?? msg.createdAt} msg={msg} />
        ))}

        {isThinking && (
          <div className="flex justify-start mb-3">
            <div
              className="bg-white border border-gray-100"
              style={{ borderRadius: '2px 12px 12px 12px' }}
            >
              <ThinkingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Analysis progress — inline below chat bubbles ── */}
      {analysisProgress && (analysisProgress.isRunning || analysisProgress.steps.length > 0) && (
        <AnalysisProgress
          steps={analysisProgress.steps}
          isRunning={analysisProgress.isRunning}
          onDismiss={analysisProgress.onDismiss ?? (() => {})}
        />
      )}

      {/* ── Quick actions ── */}
      {quickActions && quickActions.length > 0 && (
        <div className="flex-shrink-0 px-3 pb-2 flex flex-wrap gap-1.5">
          {quickActions.map((qa, i) => (
            <button
              key={i}
              onClick={() => qa.onAction()}
              disabled={isThinking}
              className="text-[10px] font-semibold px-2.5 py-1 border border-gray-200 text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
            >
              {qa.label} →
            </button>
          ))}
        </div>
      )}

      {/* ── Input ── */}
      <div ref={inputBarRef} className="flex-shrink-0 border-t border-gray-100 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything…"
            rows={1}
            disabled={isThinking}
            className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-300 border border-gray-200 px-3 py-2 focus:outline-none focus:border-gray-300 disabled:opacity-50 leading-relaxed"
            style={{
              borderRadius: 4,
              maxHeight: 120,
              overflowY: 'auto',
              minHeight: 38,
            }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isThinking}
            className="flex-shrink-0 text-[11px] font-semibold text-white px-3 py-2 transition-opacity hover:opacity-80 disabled:opacity-30 flex items-center gap-1"
            style={{ backgroundColor: '#0063FF', borderRadius: 4, height: 38 }}
          >
            {isThinking ? (
              <span
                className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin"
                style={{ borderTopColor: 'transparent' }}
              />
            ) : (
              'Send →'
            )}
          </button>
        </div>
        <p className="text-[10px] text-gray-300 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
})

export default GMChat
