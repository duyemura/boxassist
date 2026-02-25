'use client'

import { useState } from 'react'

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
    playbookName?: string
    estimatedImpact?: string
  }
}

interface ApprovalQueueProps {
  actions: ActionCard[]
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
  onEdit: (id: string) => void
  isDemo?: boolean
}

const RISK_COLORS: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#9CA3AF',
}

export default function ApprovalQueue({ actions, onApprove, onDismiss, onEdit, isDemo }: ApprovalQueueProps) {
  const [processingId, setProcessingId] = useState<string | null>(null)

  if (actions.length === 0) {
    return (
      <div className="px-6 py-8 text-center">
        <p className="text-sm text-gray-500">No actions need your attention right now.</p>
        <p className="text-xs text-gray-400 mt-1">Your agents are working. Check back soon.</p>
      </div>
    )
  }

  const handleApprove = async (id: string) => {
    setProcessingId(id)
    onApprove(id)
    // Will be removed from list by parent after API call
  }

  return (
    <div>
      <div className="px-6 pt-5 pb-3 border-b border-gray-100">
        <h2 className="text-lg font-semibold" style={{ color: '#080808' }}>
          Needs Your Approval
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {actions.length} message{actions.length !== 1 ? 's' : ''} ready to send
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {actions.map(action => (
          <div key={action.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
            {/* Member info + risk badge */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-1.5 h-1.5"
                style={{
                  backgroundColor: RISK_COLORS[action.content.riskLevel] ?? '#9CA3AF',
                  borderRadius: '50%',
                }}
              />
              <span className="text-sm font-medium text-gray-900">
                {action.content.memberName}
              </span>
              <span className="text-xs text-gray-400">
                {action.content.riskReason}
              </span>
            </div>

            {/* Draft message preview */}
            <div className="border border-gray-100 bg-white p-3 mb-3">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1">
                DRAFTED MESSAGE
              </p>
              <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">
                {action.content.draftedMessage}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => handleApprove(action.id)}
                disabled={processingId === action.id}
                className="text-xs font-semibold text-white px-4 py-1.5 hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#0063FF' }}
              >
                {processingId === action.id ? 'Sending...' : 'Approve & Send'}
              </button>
              <button
                onClick={() => onEdit(action.id)}
                className="text-xs font-semibold px-3 py-1.5 border transition-opacity hover:opacity-80"
                style={{ borderColor: '#0063FF', color: '#0063FF' }}
              >
                Edit
              </button>
              <button
                onClick={() => onDismiss(action.id)}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors px-2 py-1.5"
              >
                Skip
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
