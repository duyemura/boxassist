'use client'

interface ActionCard {
  id: string
  content: {
    memberId?: string
    memberName?: string
    riskLevel?: 'high' | 'medium' | 'low'
    riskReason?: string
    playbookName?: string
    priority?: string
  }
  approved: boolean | null
  dismissed: boolean | null
}

interface QuickQueueProps {
  actions: ActionCard[]
  maxItems?: number
  onSelect?: (action: ActionCard) => void
  onDismiss?: (id: string) => void
}

const RISK_COLOR: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#9CA3AF',
}

export default function QuickQueue({ actions, maxItems = 4, onSelect, onDismiss }: QuickQueueProps) {
  const visible = actions.slice(0, maxItems)
  const overflow = Math.max(0, actions.length - maxItems)

  return (
    <div className="px-4 pt-3 pb-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
          Needs Review
        </p>
        {actions.length > 0 && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 tabular-nums"
            style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#D97706' }}
          >
            {actions.length}
          </span>
        )}
      </div>

      {actions.length === 0 ? (
        <p className="text-xs text-gray-400">All clear — nothing pending.</p>
      ) : (
        <>
          <div className="space-y-0.5">
            {visible.map(action => {
              const risk = action.content.riskLevel ?? 'medium'
              return (
                <button
                  key={action.id}
                  onClick={() => onSelect?.(action)}
                  className="w-full text-left px-2 py-2 flex items-start gap-2 hover:bg-gray-50 transition-colors group"
                >
                  <div
                    className="w-1.5 h-1.5 flex-shrink-0 mt-1.5"
                    style={{ backgroundColor: RISK_COLOR[risk] ?? '#9CA3AF' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-medium text-gray-900 truncate">
                        {action.content.memberName ?? 'Client'}
                      </span>
                      {action.content.playbookName && (
                        <span className="text-[10px] text-gray-400 truncate hidden sm:inline">
                          {action.content.playbookName}
                        </span>
                      )}
                    </div>
                    {action.content.riskReason && (
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {action.content.riskReason}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onDismiss?.(action.id) }}
                    className="flex-shrink-0 text-[10px] text-gray-300 hover:text-gray-500 transition-colors opacity-0 group-hover:opacity-100 px-1 py-0.5"
                  >
                    skip
                  </button>
                </button>
              )
            })}
          </div>
          {overflow > 0 && (
            <p className="text-[10px] text-gray-400 mt-2 pl-4">
              +{overflow} more
            </p>
          )}
        </>
      )}
    </div>
  )
}
