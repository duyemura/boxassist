'use client'

/**
 * ReviewQueue — the approval queue for any agent.
 *
 * Shows ActionCards that need owner review. Each card has:
 *   - Risk level dot + member name + confidence badge + impact
 *   - Risk reason (1 line)
 *   - Draft message preview (2 lines, monospace)
 *   - Inline Skip / Approve buttons
 *   - Click body → opens full detail (ActionSlidePanel)
 */

interface ActionCard {
  id: string
  content: {
    memberId?: string
    memberName?: string
    memberEmail?: string
    riskLevel?: 'high' | 'medium' | 'low'
    riskReason?: string
    recommendedAction?: string
    draftedMessage?: string
    messageSubject?: string
    confidence?: number
    insights?: string
    playbookName?: string
    estimatedImpact?: string
  }
  approved: boolean | null
  dismissed: boolean | null
}

interface ReviewQueueProps {
  items: ActionCard[]
  onApprove: (id: string) => void
  onSkip: (id: string) => void
  onSelectItem: (action: ActionCard) => void
  executionMode?: 'manual' | 'limited_auto'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_DOT: Record<string, string> = {
  high:   '#EF4444',
  medium: '#F59E0B',
  low:    '#9CA3AF',
}

function ConfidenceBadge({ value }: { value?: number }) {
  if (value === undefined) return null
  const isHigh = value >= 75
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 flex-shrink-0"
      style={{
        color: isHigh ? '#0063FF' : '#B45309',
        backgroundColor: isHigh ? 'rgba(0,99,255,0.08)' : 'rgba(180,83,9,0.08)',
      }}
    >
      {value}%
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReviewQueue({
  items,
  onApprove,
  onSkip,
  onSelectItem,
  executionMode,
}: ReviewQueueProps) {
  if (items.length === 0) {
    return (
      <div className="border border-gray-100 px-5 py-8 text-center">
        <p className="text-sm text-gray-500 font-medium mb-1">Nothing to review</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          {executionMode === 'limited_auto'
            ? 'The agent is sending high-confidence messages automatically. Only edge cases surface here.'
            : 'Run a scan to find at-risk members, or ask the GM agent a question.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-px">
      {items.map(item => {
        const c = item.content
        const riskColor = RISK_DOT[c.riskLevel ?? 'low']
        const draftPreview = c.draftedMessage?.replace(/\\n/g, ' ').trim()

        return (
          <div
            key={item.id}
            className="border border-gray-100 bg-white hover:border-gray-200 transition-colors"
          >
            {/* Clickable body */}
            <div
              className="px-4 pt-3.5 pb-2 cursor-pointer"
              onClick={() => onSelectItem(item)}
            >
              {/* Row 1: name + confidence + impact */}
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: riskColor }}
                />
                <span className="text-sm font-medium text-gray-900 flex-1 truncate">
                  {c.memberName ?? 'Unknown member'}
                </span>
                <ConfidenceBadge value={c.confidence} />
                {c.estimatedImpact && (
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {c.estimatedImpact}
                  </span>
                )}
              </div>

              {/* Row 2: risk reason */}
              {c.riskReason && (
                <p className="text-xs text-gray-500 truncate mb-1.5 ml-3.5">
                  {c.riskReason}
                </p>
              )}

              {/* Row 3: draft preview */}
              {draftPreview && (
                <p
                  className="text-xs text-gray-400 leading-relaxed ml-3.5"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}
                >
                  "{draftPreview}"
                </p>
              )}
            </div>

            {/* Action row */}
            <div className="px-4 pb-3 flex items-center justify-end gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onSkip(item.id) }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1"
              >
                Skip
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onSelectItem(item) }}
                className="text-xs font-semibold px-3 py-1 transition-colors border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300"
              >
                Edit
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onApprove(item.id) }}
                className="text-xs font-semibold text-white px-3 py-1 transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#0063FF' }}
              >
                Approve &amp; Send →
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
