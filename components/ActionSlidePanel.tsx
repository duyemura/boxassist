'use client'

import { useState } from 'react'

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
  onMarkDone: (id: string) => void
}

// ─── Insight badge helper ─────────────────────────────────────────────────────

function getInsightBadge(
  insightType?: string,
  playbookName?: string,
  riskLevel?: string,
): { label: string; color: string; bg: string } {
  switch (insightType) {
    case 'churn_risk':
      return { label: 'Churn Risk', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
    case 'renewal_at_risk':
      return { label: 'Renewal Risk', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' }
    case 'payment_failed':
      return { label: 'Payment Issue', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
    case 'lead_going_cold':
      return { label: 'Lead Going Cold', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' }
    case 'win_back':
      return { label: 'Win-Back', color: '#0063FF', bg: 'rgba(0,99,255,0.08)' }
    default: {
      if (playbookName) {
        const p = playbookName.toLowerCase()
        if (p.includes('churn') || p.includes('at-risk') || p.includes('at_risk')) {
          return { label: 'Churn Risk', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
        }
        if (p.includes('renewal')) {
          return { label: 'Renewal Risk', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' }
        }
        if (p.includes('payment')) {
          return { label: 'Payment Issue', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
        }
        if (p.includes('win') || p.includes('lapsed')) {
          return { label: 'Win-Back', color: '#0063FF', bg: 'rgba(0,99,255,0.08)' }
        }
        if (p.includes('lead')) {
          return { label: 'Lead Going Cold', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' }
        }
        return { label: playbookName, color: '#6B7280', bg: 'rgba(107,114,128,0.08)' }
      }
      if (riskLevel === 'high') {
        return { label: 'Churn Risk', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
      }
      if (riskLevel === 'medium') {
        return { label: 'Renewal Risk', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' }
      }
      return { label: 'Insight', color: '#6B7280', bg: 'rgba(107,114,128,0.08)' }
    }
  }
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
  onMarkDone,
}: ActionSlidePanelProps) {
  if (!action) return null

  const c = action.content

  // Field name fallbacks: support both old and new field names
  const detail = c.detail ?? c.insights ?? c.riskReason ?? ''
  const draftMessage = c.draftMessage ?? c.draftedMessage ?? ''
  const badge = getInsightBadge(c.insightType, c.playbookName, c.riskLevel)

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

        {/* Suggested message */}
        {draftMessage && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
                Suggested message
              </p>
              <CopyButton text={draftMessage} />
            </div>
            <textarea
              readOnly
              value={draftMessage}
              rows={7}
              className="w-full text-xs text-gray-700 p-3 resize-none focus:outline-none font-mono leading-relaxed"
              style={{
                backgroundColor: '#F9FAFB',
                border: '1px solid #E5E7EB',
                cursor: 'default',
              }}
            />
            <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
              Edit and send this yourself — your words, your relationship
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
          Dismiss
        </button>
        <button
          onClick={() => onMarkDone(action.id)}
          className="text-xs font-semibold text-white px-5 py-2 transition-opacity hover:opacity-85"
          style={{ backgroundColor: '#22C55E' }}
        >
          Mark Done
        </button>
      </div>
    </div>
  )
}
