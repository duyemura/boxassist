'use client'

import { useState, useRef, useEffect } from 'react'

interface ActionCard {
  id: string
  content: {
    memberId: string
    memberName: string
    memberEmail: string
    riskLevel: 'high' | 'medium' | 'low'
    riskReason: string
    playbookName?: string
    recommendedAction: string
    draftedMessage: string
    messageSubject: string
    confidence: number
    insights: string
  }
  approved: boolean | null
  dismissed: boolean | null
}

interface ActionSlidePanelProps {
  action: ActionCard
  isDemo: boolean
  isSandboxDemo: boolean
  humanizing?: boolean
  gmailConnected?: boolean
  onSend: (id: string, name: string, message: string) => void
  onRealDemoSend: (message: string, subject: string, memberName: string, memberEmail: string) => Promise<string | null>
  onSkip: (id: string) => void
}

// ─── Email simulation ──────────────────────────────────────────────────────────

type EmailState =
  | 'idle'
  | 'sending'
  | 'sent'
  | 'reply_incoming'
  | 'reply_shown'
  | 'agent_thinking'
  | 'agent_replied'
  | 'following_up'

interface ThreadMessage {
  id: string
  direction: 'outbound' | 'inbound'
  text: string
  timestamp: string
  isThinking?: boolean
}

interface SimScript {
  memberReply: string
  agentReasoning: string
  agentFollowUp: string
}

const SIM_SCRIPTS: Record<string, SimScript> = {
  'Sarah Chen': {
    memberReply: "Hey! Oh wow thanks for reaching out. Life has just been crazy lately honestly. I've been meaning to come back but keep putting it off 😅",
    agentReasoning: "Sarah's warm and receptive — not gone, just busy. This is a save. Going to make it easy for her to return.",
    agentFollowUp: "Totally get it — life gets busy! No pressure at all. We're here whenever you're ready. If it helps, Coach Marcus said he'd love to do a quick 1-on-1 session with you to ease back in — totally on us. Just say the word and we'll find a time that works. 💪",
  },
  'Derek Walsh': {
    memberReply: "Yeah honestly I've been going through some stuff. Work has been brutal. I do want to keep my membership though.",
    agentReasoning: "Derek wants to stay — he just needs a reason to show up. Don't push hard. Make it easy.",
    agentFollowUp: "That's all I needed to hear — we've got you. No pressure to be here every day. Even one session a week keeps the momentum going. Come in whenever works, even just to decompress. We'll be here.",
  },
  'Priya Patel': {
    memberReply: "Aw thanks for checking in! I've just been doing some home workouts lately. Might switch to a lighter membership?",
    agentReasoning: "Priya is considering downgrading, not leaving. This is a retention opportunity — acknowledge her needs, don't push back hard.",
    agentFollowUp: "Totally fair — and honestly that's what we're here for. Let's make sure you're on the right plan for where you're at. I'll have someone reach out this week to walk through the options with you. Sound good?",
  },
}

function getScript(memberName: string): SimScript {
  if (SIM_SCRIPTS[memberName]) return SIM_SCRIPTS[memberName]
  return {
    memberReply: "Thanks for reaching out! I appreciate you checking in.",
    agentReasoning: "Member responded positively. Following up to keep the conversation warm.",
    agentFollowUp: "Great to hear from you! We'd love to see you back. Let us know if there's anything we can do to help.",
  }
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 4,
            height: 4,
            borderRadius: '50%',
            backgroundColor: '#9ca3af',
            animation: `dotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  )
}

function EmailThread({
  thread,
  emailState,
  memberName,
  agentReasoning,
  showConnectNote,
}: {
  thread: ThreadMessage[]
  emailState: EmailState
  memberName: string
  agentReasoning: string
  showConnectNote: boolean
}) {
  return (
    <div className="space-y-3 mt-3">
      {thread.map(msg => {
        if (msg.isThinking) {
          return (
            <div key={msg.id} className="flex items-center gap-1 py-1 px-1">
              <span className="text-xs text-gray-400 italic">Agent thinking</span>
              <ThinkingDots />
            </div>
          )
        }
        if (msg.direction === 'outbound') {
          return (
            <div key={msg.id} style={{ backgroundColor: '#E8F1FF', padding: '10px 12px' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: '#0063FF' }}>You &rarr;</span>
                <span className="text-xs text-gray-400">{msg.timestamp}</span>
              </div>
              <p className="text-xs leading-relaxed text-gray-700" style={{
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              } as React.CSSProperties}>{msg.text}</p>
            </div>
          )
        }
        return (
          <div key={msg.id} style={{
            backgroundColor: '#ffffff',
            border: '1px solid #f3f4f6',
            padding: '10px 12px',
            animation: 'fadeInUp 0.35s ease-out',
          }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-700">&larr; {memberName} replied</span>
              <span className="text-xs text-gray-400">{msg.timestamp}</span>
            </div>
            <p className="text-xs leading-relaxed text-gray-700">{msg.text}</p>
          </div>
        )
      })}

      {(emailState === 'agent_thinking' || emailState === 'agent_replied' || emailState === 'following_up') && agentReasoning && (
        <div className="flex items-start gap-1.5 px-1" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
          <p className="text-xs text-gray-400 italic leading-relaxed">{agentReasoning}</p>
        </div>
      )}

      {(emailState === 'agent_replied' || emailState === 'following_up') && (
        <div className="text-xs text-gray-400 pt-1">
          Agent is following up · Watching for reply
        </div>
      )}

      {showConnectNote && (
        <div className="mt-3 pt-3 border-t border-gray-100" style={{ animation: 'fadeInUp 0.4s ease-out' }}>
          <p className="text-xs text-gray-400">
            In your gym, these emails send from your real address and replies come back automatically.{' '}
            <a href="/login" className="underline" style={{ color: '#0063FF' }}>Connect your gym &rarr;</a>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Member action panel ───────────────────────────────────────────────────────

// ─── Send modes ───────────────────────────────────────────────────────────────

const SEND_MODES = [
  {
    id: 'send' as const,
    label: 'Send Now',
    ownerLabel: 'Send Now',
    color: '#0063FF',
    tooltip: 'You send it, agent watches. The message goes out immediately from your account. If the member replies, it shows up in Needs Attention for you to handle.',
  },
  {
    id: 'smart' as const,
    label: 'Send & Enter Smart Mode',
    ownerLabel: 'Send & Enter Smart Mode',
    color: '#0063FF',
    tooltip: 'You send it, agent co-pilots the replies. The agent reads member responses and replies autonomously when it\'s confident. If it\'s unsure or the goal isn\'t being met, it escalates to you.',
  },
  {
    id: 'auto' as const,
    label: 'Send & Enter Full Auto Mode',
    ownerLabel: 'Send & Enter Full Auto Mode',
    color: '#16A34A',
    tooltip: 'Agent owns the whole conversation. It sends this message, reads replies, follows up as needed, and closes the task when the goal is achieved — no input from you required. You\'ll only hear about it if something goes wrong.',
  },
]

function SendButton({
  sendMode, setSendMode, sendTo, realSending, gmailConnected, onSend, onAgentHandle,
}: {
  sendMode: 'send' | 'smart' | 'auto'
  setSendMode: (m: 'send' | 'smart' | 'auto') => void
  sendTo: string
  realSending: boolean
  gmailConnected: boolean
  onSend: () => void
  onAgentHandle: () => void
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mode = SEND_MODES.find(m => m.id === sendMode)!

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handlePrimary = () => {
    if (sendMode === 'send') onSend()
    else onAgentHandle()
  }

  return (
    <div className="space-y-1.5" ref={ref}>
      {/* Split button row */}
      <div className="flex items-stretch" style={{ border: `1px solid ${mode.color}` }}>
        {/* Primary button */}
        <button
          onClick={handlePrimary}
          disabled={sendMode === 'send' && (!sendTo.trim() || realSending)}
          className="flex-1 text-xs font-semibold text-white px-4 py-2 transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: mode.color }}
        >
          {realSending ? 'Sending…' : mode.ownerLabel}
        </button>

        {/* Divider */}
        <div style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />

        {/* Chevron dropdown trigger */}
        <button
          onClick={() => setDropdownOpen(v => !v)}
          className="px-2.5 text-white transition-opacity hover:opacity-80 flex items-center"
          style={{ backgroundColor: mode.color }}
          aria-label="Choose send mode"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="square"/>
          </svg>
        </button>
      </div>

      {/* Dropdown menu */}
      {dropdownOpen && (
        <div className="border border-gray-200 bg-white overflow-hidden" style={{ position: 'relative', zIndex: 50 }}>
          {SEND_MODES.map((m, i) => (
            <button
              key={m.id}
              onClick={() => { setSendMode(m.id); setDropdownOpen(false) }}
              className="w-full text-left px-3 py-2.5 transition-colors hover:bg-gray-50 flex flex-col gap-0.5"
              style={{ borderTop: i > 0 ? '1px solid #F3F4F6' : 'none' }}
            >
              <div className="flex items-center gap-2">
                {sendMode === m.id && (
                  <span style={{ color: m.color, fontSize: 10 }}>✓</span>
                )}
                {sendMode !== m.id && <span style={{ width: 10 }} />}
                <span className="text-xs font-semibold" style={{ color: m.color }}>{m.label}</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed pl-4">{m.tooltip}</p>
            </button>
          ))}
        </div>
      )}

      {/* Tooltip — always visible under button, explains current mode */}
      <p className="text-[10px] text-gray-400 leading-relaxed px-0.5">
        {mode.tooltip}
      </p>
    </div>
  )
}

// ─── Member action panel ───────────────────────────────────────────────────────

function MemberActionPanel({
  action,
  isDemo,
  isSandboxDemo,
  humanizing,
  gmailConnected,
  onSend,
  onRealDemoSend,
  onSkip,
}: ActionSlidePanelProps) {
  const c = action.content
  const [draftMessage, setDraftMessage] = useState(c.draftedMessage || '')
  const [agentState, setAgentState] = useState<'idle' | 'working' | 'done'>('idle')
  const [emailState, setEmailState] = useState<EmailState>('idle')
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [showConnectNote, setShowConnectNote] = useState(false)
  const [realSending, setRealSending] = useState(false)
  const [realSent, setRealSent] = useState(false)
  const [realSentTo, setRealSentTo] = useState('')
  const [liveReplyToken, setLiveReplyToken] = useState<string | null>(null)
  const [liveThread, setLiveThread] = useState<Array<{id: string, role: string, text: string, created_at: string, _decision?: any}>>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [priorThreads, setPriorThreads] = useState<any[]>([])
  const [priorThreadsOpen, setPriorThreadsOpen] = useState(false)
  const [sendMethod, setSendMethod] = useState<'email' | 'sms' | 'whatsapp'>('email')
  const [sendMode, setSendMode] = useState<'send' | 'smart' | 'auto'>('send')
  const [sendTo, setSendTo] = useState(c.memberEmail || '')
  const isVisitorCard = c.memberId === 'demo-visitor'
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteInstruction, setRewriteInstruction] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewriteError, setRewriteError] = useState<string | null>(null)
  const [membershipValue, setMembershipValue] = useState(130)
  const [editingValue, setEditingValue] = useState(false)
  const [draftValue, setDraftValue] = useState('130')
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const script = getScript(c.memberName)

  useEffect(() => {
    return () => { timersRef.current.forEach(clearTimeout) }
  }, [])

  const push = (delay: number, fn: () => void) => {
    const t = setTimeout(fn, delay)
    timersRef.current.push(t)
  }

  const handleAgentHandle = async () => {
    setAgentState('working')
    // In sandbox demo: actually send the email so they experience the real loop
    if (isSandboxDemo && sendTo) {
      try {
        const token = await onRealDemoSend(draftMessage, c.messageSubject, c.memberName, sendTo)
        if (token) startLiveThread(token)
      } catch {}
    }
    push(2000, () => setAgentState('done'))
  }

  const runEmailSimulation = () => {
    setEmailState('sending')
    push(500, () => {
      setEmailState('sent')
      setThread([{ id: 'out-1', direction: 'outbound', text: draftMessage, timestamp: 'Sent just now' }])
    })
    push(6000, () => setEmailState('reply_incoming'))
    push(6500, () => {
      setEmailState('reply_shown')
      setThread(prev => [...prev, { id: 'in-1', direction: 'inbound', text: script.memberReply, timestamp: '1 minute ago' }])
    })
    push(9000, () => {
      setEmailState('agent_thinking')
      setThread(prev => [...prev, { id: 'thinking', direction: 'outbound', text: '', timestamp: '', isThinking: true }])
    })
    push(12000, () => {
      setEmailState('agent_replied')
      setThread(prev => [
        ...prev.filter(m => m.id !== 'thinking'),
        { id: 'out-2', direction: 'outbound', text: script.agentFollowUp, timestamp: 'Sent just now' },
      ])
    })
    push(12500, () => setEmailState('following_up'))
    push(15500, () => setShowConnectNote(true))
  }

  const startLiveThread = (token: string) => {
    setLiveReplyToken(token)
    // Poll immediately, then every 3s
    const fetchThread = async () => {
      try {
        const res = await fetch(`/api/conversations/${token}`)
        const data = await res.json()
        if (data.messages) setLiveThread(data.messages)
      } catch {}
    }
    fetchThread()
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(fetchThread, 3000)
  }

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // Load prior conversation history for this member on mount
  useEffect(() => {
    if (!c.memberEmail) return
    fetch(`/api/conversations/by-email?email=${encodeURIComponent(c.memberEmail)}`)
      .then(r => r.json())
      .then(data => {
        if (data.threads?.length) setPriorThreads(data.threads)
      })
      .catch(() => {})
  }, [c.memberEmail])

  const handleSend = async () => {
    if (isDemo && isSandboxDemo) {
      setRealSending(true)
      try {
        const token = await onRealDemoSend(draftMessage, c.messageSubject, c.memberName, sendTo)
        setRealSent(true)
        setRealSentTo(sendTo)
        if (token) startLiveThread(token)
      } catch {}
      setRealSending(false)
    } else if (isDemo) {
      runEmailSimulation()
    } else {
      onSend(action.id, c.memberName, draftMessage)
    }
  }

  const handleRewrite = async () => {
    if (!rewriteInstruction.trim()) return
    setRewriting(true)
    setRewriteError(null)
    try {
      const res = await fetch('/api/rewrite-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentMessage: draftMessage,
          instruction: rewriteInstruction,
          memberName: c.memberName,
          memberContext: c.insights,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Rewrite failed')
      setDraftMessage(data.message)
      setRewriteInstruction('')
      setRewriteOpen(false)
    } catch (err: any) {
      setRewriteError(err.message)
    } finally {
      setRewriting(false)
    }
  }

  const riskLabels: Record<string, string> = {
    high: 'High risk',
    medium: 'Medium risk',
    low: 'Low risk',
  }

  // Agent-handled
  if (agentState === 'working' || agentState === 'done') {
    return (
      <div className="p-4">
        <div className="flex items-center gap-3 py-4">
          {agentState === 'working' ? (
            <span className="text-xs text-gray-400">Agent handling {c.memberName}&hellip;</span>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
              <span className="text-xs text-gray-400">Message sent · {c.memberName}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  // Real demo sent
  if (realSent) {
    const decision = liveThread.find(m => m.role === 'agent_decision')?._decision
    const closed = decision?.action === 'close' || decision?.resolved === true
    const escalated = decision?.action === 'escalate'

    return (
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${closed ? 'bg-green-400' : 'animate-pulse'}`} style={{ backgroundColor: closed ? '#16A34A' : '#0063FF' }} />
          <span className="text-xs font-medium text-gray-700">{c.memberName}</span>
          <span className="text-gray-300 text-xs">·</span>
          <span className="text-xs text-gray-500">
            {closed ? 'Goal achieved · Closed' : escalated ? 'Needs attention' : liveThread.length > 1 ? 'Watching for reply…' : `Sent to ${realSentTo}`}
          </span>
        </div>

        {/* Live conversation thread */}
        <div className="space-y-2">
          {liveThread.filter(m => m.role !== 'agent_decision').map((msg) => {
            const isOutbound = msg.role === 'outbound'
            return (
              <div key={msg.id} className={`px-3 py-2 ${isOutbound ? '' : ''}`} style={{
                backgroundColor: isOutbound ? 'rgba(0,99,255,0.06)' : '#F9FAFB',
                borderLeft: `2px solid ${isOutbound ? '#0063FF' : '#E5E7EB'}`,
              }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: isOutbound ? '#0063FF' : '#6B7280' }}>
                    {isOutbound ? 'Agent' : c.memberName}
                  </span>
                  <span className="text-[10px] text-gray-300">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs text-gray-700 leading-relaxed">{msg.text}</p>
              </div>
            )
          })}

          {/* Agent decision summary */}
          {decision && (
            <div className="px-3 py-2" style={{ backgroundColor: closed ? 'rgba(22,163,74,0.06)' : escalated ? 'rgba(245,158,11,0.06)' : 'rgba(0,99,255,0.04)', borderLeft: `2px solid ${closed ? '#16A34A' : escalated ? '#F59E0B' : '#0063FF'}` }}>
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: closed ? '#16A34A' : escalated ? '#F59E0B' : '#0063FF' }}>
                {closed ? '✓ Goal achieved' : escalated ? '⚠ Escalated' : 'Agent decision'}
              </span>
              <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{decision.scoreReason} {decision.outcomeScore != null ? `(${decision.outcomeScore}/100)` : ''}</p>
            </div>
          )}

          {/* Waiting indicator */}
          {!decision && liveThread.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: '#0063FF' }} />
              <span className="text-[10px] text-gray-400">Agent monitoring for reply…</span>
            </div>
          )}
        </div>

        {/* CTA */}
        {!closed && (
          <p className="text-[10px] text-gray-400">
            Reply to the email you just received — the agent will respond in real time.
          </p>
        )}
        <p className="text-[10px]">
          <a href="/login" style={{ color: '#0063FF' }}>
            Connect your gym to send from your own Gmail &rarr;
          </a>
        </p>
      </div>
    )
  }

  // Sending state
  if (realSending) {
    return (
      <div className="p-4 flex items-center gap-3 py-4">
        <span className="text-xs text-gray-400">
          Sending to <span className="text-gray-600 font-medium">{c.memberEmail}</span>&hellip;
        </span>
      </div>
    )
  }

  // Email simulation active
  if (isDemo && emailState !== 'idle') {
    const isFollowingUp = emailState === 'agent_replied' || emailState === 'following_up'
    const statusMap: Record<EmailState, string> = {
      idle: '',
      sending: 'Sending…',
      sent: 'Sent',
      reply_incoming: 'Member replied ↩',
      reply_shown: 'Member replied',
      agent_thinking: 'Agent thinking…',
      agent_replied: 'Following up · Agent handling',
      following_up: 'Following up · Agent handling',
    }
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              backgroundColor: isFollowingUp ? '#16A34A' : '#0063FF',
              animation: emailState === 'reply_incoming' ? 'pulse 0.8s ease-in-out 4' : 'none',
            }}
          />
          <span className="text-xs font-medium text-gray-700">{c.memberName}</span>
          <span className="text-gray-300 text-xs">·</span>
          <span className="text-xs text-gray-500">{statusMap[emailState]}</span>
        </div>
        {thread.length > 0 && (
          <EmailThread
            thread={thread}
            emailState={emailState}
            memberName={c.memberName}
            agentReasoning={script.agentReasoning}
            showConnectNote={showConnectNote}
          />
        )}
      </div>
    )
  }

  // Normal view
  return (
    <div className="p-4 space-y-5">

      {/* Demo mode callout — shown for all demo actions */}
      {isSandboxDemo && (
        <div className="px-3 py-2.5 flex items-start gap-2" style={{ backgroundColor: '#F4FF78', borderLeft: '3px solid #080808' }}>
          <div className="flex-1">
            <p className="text-[10px] font-bold tracking-widest uppercase mb-0.5" style={{ color: '#080808' }}>Demo Mode</p>
            {c.memberId === 'demo-visitor'
              ? <p className="text-xs leading-relaxed" style={{ color: '#080808' }}>That&rsquo;s you in the member list. The agent flagged your profile and drafted this outreach — send it to see exactly what your members receive.</p>
              : <p className="text-xs leading-relaxed" style={{ color: '#080808' }}>This is a real action from a live gym. In your account, this would show your members — and sends would come from your Gmail.</p>
            }
          </div>
        </div>
      )}

      {/* Member header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-gray-900">{c.memberName}</h3>
          {c.memberId === 'demo-visitor' && (
            <span className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5" style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}>that&rsquo;s you</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {riskLabels[c.riskLevel]} · {c.riskReason}
        </p>
      </div>

      {/* Playbooks used */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">Playbooks used</p>
        <div className="flex flex-wrap gap-1.5">
          {c.playbookName ? (
            <span className="text-[10px] font-semibold px-2 py-0.5" style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}>
              {c.playbookName}
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5" style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}>
              At-Risk Monitor
            </span>
          )}
          {/* Humanizer always shown — it runs on every message */}
          <span className="text-[10px] font-medium px-2 py-0.5" style={{ color: '#6B7280', backgroundColor: '#F3F4F6' }}>
            ✨ Humanizer
          </span>
        </div>
      </div>

      {/* Situation */}
      {c.insights && (
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">Situation</p>
          <p className="text-xs text-gray-600 leading-relaxed">{c.insights}</p>
        </div>
      )}

      {/* Drafted message */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Drafted message</p>
          <button
            onClick={() => { setRewriteOpen(!rewriteOpen); setRewriteError(null) }}
            className="flex items-center gap-1 text-xs font-medium transition-colors px-2 py-0.5"
            style={{ color: rewriteOpen ? '#0063FF' : '#9CA3AF' }}
            title="AI rewrite"
          >
            <span>✨</span>
            <span>{rewriteOpen ? 'Cancel' : 'Rewrite'}</span>
          </button>
        </div>

        {/* AI rewrite panel */}
        {rewriteOpen && (
          <div className="mb-2 border border-blue-100 bg-blue-50/40 p-3 space-y-2">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Tell the AI how to change it — or paste some rough ideas and it'll polish them up.
            </p>
            <textarea
              value={rewriteInstruction}
              onChange={e => setRewriteInstruction(e.target.value)}
              placeholder="e.g. Make it shorter and more casual… or: She's been a member for 2 years, mention that…"
              rows={2}
              className="w-full text-xs border border-blue-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 resize-none transition-colors"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRewrite() }}
              autoFocus
            />
            {rewriteError && <p className="text-xs text-red-500">{rewriteError}</p>}
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400">⌘↵ to rewrite</p>
              <button
                onClick={handleRewrite}
                disabled={!rewriteInstruction.trim() || rewriting}
                className="text-xs font-semibold text-white px-3 py-1.5 transition-opacity disabled:opacity-40"
                style={{ backgroundColor: '#0063FF' }}
              >
                {rewriting ? 'Rewriting…' : 'Rewrite ✨'}
              </button>
            </div>
          </div>
        )}

        <div className={`border transition-colors ${humanizing ? 'border-blue-200' : 'border-gray-200'}`}>
          {humanizing && (
            <div className="px-3 py-1.5 border-b border-blue-100 flex items-center gap-1.5" style={{ backgroundColor: '#EEF5FF' }}>
              <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: '#0063FF' }} />
              <span className="text-[10px]" style={{ color: '#0063FF' }}>Humanizing draft…</span>
            </div>
          )}
          <textarea
            value={draftMessage}
            onChange={e => setDraftMessage(e.target.value)}
            rows={6}
            className={`w-full bg-gray-50 text-xs text-gray-700 p-3 resize-none focus:outline-none focus:ring-1 focus:ring-gray-300 font-mono leading-relaxed transition-opacity ${humanizing ? 'opacity-50' : 'opacity-100'}`}
          />
          {c.messageSubject && (
            <div className="px-3 py-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">Subject: </span>
              <span className="text-xs text-gray-500">{c.messageSubject}</span>
            </div>
          )}
        </div>
      </div>

      {/* Send method selector + editable contact — always shown */}
      <div className="border border-gray-100 overflow-hidden">
        {/* Method tabs */}
        <div className="flex divide-x divide-gray-100 border-b border-gray-100">
          {[
            { id: 'email', label: 'Email', available: true },
            { id: 'sms', label: 'SMS', available: false },
            { id: 'whatsapp', label: 'WhatsApp', available: false },
          ].map(method => (
            <button
              key={method.id}
              disabled={!method.available}
              onClick={() => method.available && setSendMethod(method.id as any)}
              className="flex-1 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: sendMethod === method.id ? '#EEF5FF' : 'white',
                color: !method.available ? '#D1D5DB' : sendMethod === method.id ? '#0063FF' : '#6B7280',
                cursor: method.available ? 'pointer' : 'default',
              }}
            >
              {method.label}{!method.available && <span className="ml-1 text-[10px]">soon</span>}
            </button>
          ))}
        </div>

        {/* Contact field — pre-filled, editable */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 flex-shrink-0">
              {sendMethod === 'email' ? 'To:' : sendMethod === 'sms' ? 'Phone:' : 'WA:'}
            </span>
            <input
              type={sendMethod === 'email' ? 'email' : 'tel'}
              value={sendTo}
              onChange={e => setSendTo(e.target.value)}
              placeholder={sendMethod === 'email' ? 'email@example.com' : '+1 (555) 000-0000'}
              className="flex-1 text-xs text-gray-900 focus:outline-none bg-transparent"
            />
            {sendTo && (
              <button onClick={() => setSendTo('')} className="text-[10px] text-gray-300 hover:text-gray-500">✕</button>
            )}
          </div>
        </div>
      </div>

      {/* Split send button + mode dropdown */}
      <SendButton
        sendMode={sendMode}
        setSendMode={setSendMode}
        sendTo={sendTo}
        realSending={realSending}
        gmailConnected={!!gmailConnected}
        onSend={handleSend}
        onAgentHandle={handleAgentHandle}
      />

      <button
        onClick={() => onSkip(action.id)}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        Skip
      </button>

      {/* Prior conversation history */}
      {priorThreads.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <button
            onClick={() => setPriorThreadsOpen(v => !v)}
            className="flex items-center justify-between w-full mb-2"
          >
            <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
              Prior conversations · {priorThreads.length}
            </p>
            <span className="text-[10px] text-gray-300">{priorThreadsOpen ? '▲' : '▼'}</span>
          </button>
          {priorThreadsOpen && (
            <div className="space-y-3">
              {priorThreads.map((thread: any) => {
                const visible = thread.messages.filter((m: any) => m.role !== 'agent_decision')
                const decision = thread.messages.find((m: any) => m.role === 'agent_decision')?._decision
                const closed = decision?.action === 'close' || decision?.resolved
                return (
                  <div key={thread.action_id} className="border border-gray-100">
                    <div className="px-3 py-1.5 flex items-center justify-between" style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #F3F4F6' }}>
                      <span className="text-[10px] text-gray-400">{new Date(thread.started_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      {closed && <span className="text-[10px] font-semibold" style={{ color: '#16A34A' }}>✓ Resolved</span>}
                      {!closed && <span className="text-[10px] text-gray-300">Open</span>}
                    </div>
                    <div className="p-2 space-y-1.5">
                      {visible.slice(0, 3).map((msg: any) => (
                        <div key={msg.id} className="flex gap-1.5">
                          <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: msg.role === 'outbound' ? '#0063FF' : '#374151', width: 36 }}>
                            {msg.role === 'outbound' ? 'Agent' : 'Them'}
                          </span>
                          <span className="text-[10px] text-gray-500 leading-relaxed line-clamp-2">{msg.text}</span>
                        </div>
                      ))}
                      {visible.length > 3 && <p className="text-[10px] text-gray-300">+{visible.length - 3} more messages</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Assigned value */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-2">Assigned value</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">
            Est.{' '}
            {editingValue ? (
              <span className="inline-flex items-center gap-0.5">
                $<input
                  type="number"
                  value={draftValue}
                  onChange={e => setDraftValue(e.target.value)}
                  className="w-14 text-xs border-b border-gray-300 bg-transparent focus:outline-none text-gray-900"
                  onBlur={() => {
                    const v = parseInt(draftValue)
                    if (!isNaN(v) && v > 0) setMembershipValue(v)
                    setEditingValue(false)
                  }}
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
                  autoFocus
                />
              </span>
            ) : (
              <span
                className="cursor-pointer border-b border-dashed border-gray-300 hover:border-gray-500"
                onClick={() => { setDraftValue(String(membershipValue)); setEditingValue(true) }}
              >
                ${membershipValue}
              </span>
            )}{' '}
            if {c.memberName.split(' ')[0]} re-engages
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">Because: 1 month avg membership</p>
      </div>
    </div>
  )
}

// ─── Main ActionSlidePanel ──────────────────────────────────────────────────────

export default function ActionSlidePanel(props: ActionSlidePanelProps) {
  const { action } = props

  // For now only 'member' type actions are real
  // action.content.memberId gives us the type signal
  // Non-member stubs shown as coming soon

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
      `}</style>
      <MemberActionPanel {...props} />
    </>
  )
}
