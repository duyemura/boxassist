'use client'

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

interface NeedsAttentionListProps {
  actions: ActionCard[]
  onSelectAction: (action: ActionCard) => void
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
    />
  )
}

export default function NeedsAttentionList({ actions, onSelectAction }: NeedsAttentionListProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">
          Needs attention {actions.length > 0 && `(${actions.length})`}
        </p>
      </div>

      {actions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <p className="text-sm text-gray-500 font-medium mb-1 text-center">Nothing needs attention right now.</p>
          <p className="text-xs text-gray-400 leading-relaxed text-center mt-1">
            When your agents find members to follow up with, they&apos;ll appear here as action cards.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {actions.map(action => (
            <button
              key={action.id}
              onClick={() => onSelectAction(action)}
              className="w-full text-left flex items-center gap-4 px-4 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors group"
            >
              <RiskIndicator level={action.content.riskLevel} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{action.content.memberName}</p>
                <p className="text-xs text-gray-400 truncate mt-0.5">{action.content.riskReason}</p>
              </div>
              <span className="text-xs text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0">
                &rarr;
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
