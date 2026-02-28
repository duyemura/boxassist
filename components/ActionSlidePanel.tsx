'use client'

import { useState, useEffect } from 'react'

// ─── Thread types ─────────────────────────────────────────────────────────────

interface ConversationMessage {
  id: string
  role: 'assistant' | 'user' | string
  content: string
  agent_name?: string | null
  evaluation?: {
    reasoning?: string
    action?: string
    outcomeScore?: number
    outcome?: string
  } | null
  created_at: string
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionSlidePanelProps {
  action: {
    id: string
    content: {
      memberName: string
      memberEmail?: string
      riskLevel?: 'high' | 'medium' | 'low'
      priority?: 'critical' | 'high' | 'medium' | 'low'
      insightType?: string
      title?: string
      riskReason?: string      // fallback for old cards
      detail?: string
      recommendedAction: string
      draftedMessage?: string  // old field name
      draftMessage?: string    // new field name
      messageSubject?: string
      estimatedImpact?: string
      insights?: string        // old field name, fallback for detail
      confidence?: number
      playbookName?: string
    }
    approved: boolean | null
    dismissed: boolean | null
  } | null
  isOpen: boolean
  onClose: () => void
  onDismiss: (id: string) => void
  onApproveAndSend: (id: string, editedMessage: string, subject: string) => void
  sending?: boolean
  // Demo only — when provided, shows "Send this email" instead of "Approve & Send"
  onSendEmail?: (id: string, message: string, subject: string) => void
  sendingEmail?: boolean
}

// ─── Insight badge helper ─────────────────────────────────────────────────────
// Uses keyword matching on the type/playbook string — works with AI-assigned types.
// No hardcoded enum switch — the AI can create any task type and it gets a sensible badge.

const BADGE_RULES: Array<{
  keywords: string[]
  label: string
  color: string
  bg: string
}> = [
  { keywords: ['payment', 'billing', 'invoice'], label: 'Payment Issue', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
  { keywords: ['churn', 'at_risk', 'at-risk', 'attendance_drop', 'disengag'], label: 'At Risk', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
  { keywords: ['renewal', 'expir'], label: 'Renewal Risk', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
  { keywords: ['win_back', 'winback', 'cancel', 'lapsed', 'reactivat'], label: 'Win-Back', color: '#0063FF', bg: 'rgba(0,99,255,0.08)' },
  { keywords: ['lead', 'prospect', 'trial', 'cold'], label: 'Lead', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
  { keywords: ['onboard', 'new_member', 'welcome'], label: 'Onboarding', color: '#22C55E', bg: 'rgba(34,197,94,0.08)' },
  { keywords: ['no_show', 'noshow', 'missed'], label: 'No-Show', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
]

function getInsightBadge(
  insightType?: string,
  playbookName?: string,
  riskLevel?: string,
  priority?: string,
): { label: string; color: string; bg: string } {
  // Combine all available text signals for keyword matching
  const haystack = [insightType, playbookName].filter(Boolean).join(' ').toLowerCase()

  for (const rule of BADGE_RULES) {
    if (rule.keywords.some(kw => haystack.includes(kw))) {
      return rule
    }
  }

  // Fallback: use priority for color, format insightType as label
  if (priority === 'critical' || riskLevel === 'high') {
    const label = insightType ? insightType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Critical'
    return { label, color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
  }
  if (priority === 'high' || riskLevel === 'medium') {
    const label = insightType ? insightType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Needs Attention'
    return { label, color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' }
  }
  if (insightType) {
    const label = insightType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    return { label, color: '#6B7280', bg: 'rgba(107,114,128,0.08)' }
  }
  return { label: 'Insight', color: '#6B7280', bg: 'rgba(107,114,128,0.08)' }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      onClick={handleCopy}
      className="text-[10px] font-semibold px-2 py-1 transition-colors"
      style={{
        color: copied ? '#22C55E' : '#6B7280',
        backgroundColor: copied ? 'rgba(34,197,94,0.08)' : '#F3F4F6',
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActionSlidePanel({
  action,
  onDismiss,
  onApproveAndSend,
  sending = false,
  onSendEmail,
  sendingEmail = false,
}: ActionSlidePanelProps) {
  const originalDraft = action?.content?.draftMessage ?? action?.content?.draftedMessage ?? ''
  const [editedMessage, setEditedMessage] = useState(originalDraft)
  const [editedSubject, setEditedSubject] = useState(action?.content?.messageSubject ?? '')
  const isEdited = editedMessage !== originalDraft

  // Thread history
  const [thread, setThread] = useState<ConversationMessage[]>([])

  // Reset edited state and fetch thread when a different action is selected
  const actionId = action?.id
  useEffect(() => {
    if (actionId) {
      setEditedMessage(action?.content?.draftMessage ?? action?.content?.draftedMessage ?? '')
      setEditedSubject(action?.content?.messageSubject ?? '')
      setThread([])
      fetch(`/api/conversations/by-task?taskId=${actionId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.messages?.length) setThread(data.messages) })
        .catch(() => {})
    }
  }, [actionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!action) return null

  const c = action.content

  // Field name fallbacks: support both old and new field names
  const detail = c.detail ?? c.insights ?? c.riskReason ?? ''
  const badge = getInsightBadge(c.insightType, c.playbookName, c.riskLevel, c.priority)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-gray-900">{c.memberName}</h2>
          <span
            className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full"
            style={{ color: badge.color, backgroundColor: badge.bg }}
          >
            {badge.label}
          </span>
        </div>
        {c.memberEmail && (
          <p className="text-xs text-gray-400 mt-0.5">{c.memberEmail}</p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

        {/* What's happening */}
        {detail && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">
              What&apos;s happening
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{detail}</p>
          </div>
        )}

        {/* Why it matters */}
        {c.estimatedImpact && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">
              Why it matters
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{c.estimatedImpact}</p>
          </div>
        )}

        {/* What to do */}
        {c.recommendedAction && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-1.5">
              What to do
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">{c.recommendedAction}</p>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* Conversation history */}
        {thread.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mb-3">
              Conversation
            </p>
            <div className="space-y-3">
              {thread.map(msg => (
                <div key={msg.id}>
                  {msg.role === 'assistant' ? (
                    /* Outbound — sent by the agent */
                    <div className="flex items-start gap-2">
                      <div
                        className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: '#0063FF' }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs leading-relaxed whitespace-pre-wrap px-3 py-2"
                          style={{ backgroundColor: '#EEF4FF', color: '#1E3A8A' }}
                        >
                          {msg.content}
                        </p>
                        <p className="text-[10px] text-gray-300 mt-1">{fmtTime(msg.created_at)}</p>
                      </div>
                    </div>
                  ) : (
                    /* Inbound — member reply */
                    <div className="flex items-start gap-2">
                      <div
                        className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: '#F3F4F6' }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs leading-relaxed whitespace-pre-wrap px-3 py-2"
                          style={{ backgroundColor: '#F9FAFB', color: '#374151', border: '1px solid #E5E7EB' }}
                        >
                          {msg.content}
                        </p>
                        <p className="text-[10px] text-gray-300 mt-1">{fmtTime(msg.created_at)}</p>
                        {/* AI evaluation after member reply */}
                        {msg.evaluation?.reasoning && (
                          <div
                            className="mt-1.5 px-2.5 py-2 text-[10px] leading-relaxed"
                            style={{ backgroundColor: '#FAFAFA', borderLeft: '2px solid #E5E7EB', color: '#6B7280' }}
                          >
                            <span className="font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>
                              AI · {msg.evaluation.action ?? 'evaluated'}
                              {msg.evaluation.outcomeScore !== undefined ? ` · ${msg.evaluation.outcomeScore}` : ''}
                            </span>
                            <span className="ml-1">{msg.evaluation.reasoning}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-4" />
          </div>
        )}

        {/* Message — editable */}
        {originalDraft && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
                {isEdited ? 'Message (edited)' : 'Suggested message'}
              </p>
              <div className="flex items-center gap-2">
                {isEdited && (
                  <button
                    onClick={() => setEditedMessage(originalDraft)}
                    className="text-[10px] font-semibold px-2 py-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Reset
                  </button>
                )}
                <CopyButton text={editedMessage} />
              </div>
            </div>

            {/* Subject line */}
            <div className="mb-2">
              <label className="text-[10px] text-gray-400 mb-0.5 block">Subject</label>
              <input
                type="text"
                value={editedSubject}
                onChange={(e) => setEditedSubject(e.target.value)}
                className="w-full text-xs text-gray-700 px-3 py-2 focus:outline-none focus:border-blue-400"
                style={{ border: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}
              />
            </div>

            {/* Message body */}
            <textarea
              value={editedMessage}
              onChange={(e) => setEditedMessage(e.target.value)}
              rows={7}
              className="w-full text-xs text-gray-700 p-3 resize-none focus:outline-none focus:border-blue-400 font-mono leading-relaxed"
              style={{
                backgroundColor: isEdited ? '#FFFFF0' : '#F9FAFB',
                border: `1px solid ${isEdited ? '#D1D5DB' : '#E5E7EB'}`,
              }}
            />
            <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
              Edit the message before sending — your words, your relationship
            </p>
          </div>
        )}

        {/* Confidence — optional metadata */}
        {c.confidence !== undefined && (
          <>
            <div className="border-t border-gray-100" />
            <p className="text-[10px] text-gray-300">
              Confidence: {Math.round(c.confidence * 100)}%
            </p>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div
        className="flex items-center justify-between px-5 py-4 border-t border-gray-100 flex-shrink-0"
        style={{ backgroundColor: '#FAFAFA' }}
      >
        <button
          onClick={() => onDismiss(action.id)}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-3 py-2 border border-gray-200 hover:bg-white"
        >
          {onSendEmail ? 'Skip' : 'Dismiss'}
        </button>
        {onSendEmail ? (
          <button
            onClick={() => onSendEmail(action.id, editedMessage, editedSubject || 'Checking in on you')}
            disabled={sendingEmail}
            className="text-xs font-semibold text-white px-5 py-2 transition-opacity hover:opacity-85 disabled:opacity-50 flex items-center gap-1.5"
            style={{ backgroundColor: '#0063FF' }}
          >
            {sendingEmail ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full border border-white border-t-transparent animate-spin" />
                Sending…
              </>
            ) : (
              'Send this email →'
            )}
          </button>
        ) : (
          <button
            onClick={() => onApproveAndSend(action.id, editedMessage, editedSubject || c.messageSubject || 'Checking in')}
            disabled={sending}
            className="text-xs font-semibold text-white px-5 py-2 transition-opacity hover:opacity-85 disabled:opacity-50 flex items-center gap-1.5"
            style={{ backgroundColor: '#0063FF' }}
          >
            {sending ? (
              <>
                <span className="w-2.5 h-2.5 border border-white border-t-transparent animate-spin" />
                Sending…
              </>
            ) : (
              <>Approve &amp; Send →</>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
