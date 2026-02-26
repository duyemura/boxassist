'use client'

import { useState } from 'react'

export interface ToDoItem {
  id: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  insightType: string  // 'churn_risk', 'renewal_at_risk', 'payment_failed', 'ad_hoc', etc.
  assignedAgent?: string  // 'gm', 'retention', 'sales'
  taskType?: string
  goal?: string
  memberName: string
  memberEmail: string
  title: string           // "Jane hasn't been in 14 days"
  detail: string          // "Risk score 74%. Used to visit 4x/week."
  recommendedAction: string
  estimatedImpact: string  // "$89/mo at risk"
  draftMessage?: string
  approved: boolean | null
  dismissed: boolean | null
}

export interface ToDoListProps {
  items: ToDoItem[]
  onSelectItem: (item: ToDoItem) => void
}

const PRIORITY_ORDER: ToDoItem['priority'][] = ['critical', 'high', 'medium', 'low']

const PRIORITY_CONFIG: Record<
  ToDoItem['priority'],
  { dot: string; label: string; emoji: string }
> = {
  critical: { dot: '#EF4444', label: 'Critical', emoji: '🔴' },
  high:     { dot: '#F97316', label: 'High',     emoji: '🟠' },
  medium:   { dot: '#F59E0B', label: 'Medium',   emoji: '🟡' },
  low:      { dot: '#9CA3AF', label: 'Low',      emoji: '⚪' },
}

function PriorityDot({ priority }: { priority: ToDoItem['priority'] }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full flex-shrink-0 inline-block mt-0.5"
      style={{ backgroundColor: PRIORITY_CONFIG[priority].dot }}
    />
  )
}

export default function ToDoList({ items, onSelectItem }: ToDoListProps) {
  const [showDismissed, setShowDismissed] = useState(false)

  const activeItems = items.filter(i => !i.dismissed)
  const dismissedItems = items.filter(i => i.dismissed)

  // Group active items by priority
  const grouped = PRIORITY_ORDER.reduce<Record<string, ToDoItem[]>>((acc, p) => {
    const group = activeItems.filter(i => i.priority === p)
    if (group.length > 0) acc[p] = group
    return acc
  }, {})

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10 flex items-center gap-2">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase flex-1">
          Your To-Do
        </p>
        {activeItems.length > 0 && (
          <span
            className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: '#EF4444' }}
          >
            {activeItems.length}
          </span>
        )}
      </div>

      {activeItems.length === 0 && dismissedItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <p className="text-sm text-gray-500 font-medium mb-1 text-center">
            Your GM Agent is watching.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed text-center mt-1">
            Nothing needs attention right now.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Priority groups */}
          {PRIORITY_ORDER.map(priority => {
            const group = grouped[priority]
            if (!group) return null
            const cfg = PRIORITY_CONFIG[priority]
            return (
              <div key={priority}>
                {/* Group header */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/60">
                  <span className="text-[10px]">{cfg.emoji}</span>
                  <span className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
                    {cfg.label} — {group.length} item{group.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Items */}
                {group.map(item => (
                  <button
                    key={item.id}
                    onClick={() => onSelectItem(item)}
                    className="w-full text-left flex items-start gap-3 px-4 py-3.5 border-b border-gray-100 hover:bg-gray-50 transition-colors group"
                  >
                    <PriorityDot priority={item.priority} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 leading-snug">{item.memberName}</p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{item.title}</p>
                    </div>
                    {item.estimatedImpact && (
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{item.estimatedImpact}</span>
                    )}
                    <span className="text-xs text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0 mt-0.5">
                      →
                    </span>
                  </button>
                ))}
              </div>
            )
          })}

          {/* Empty active but has dismissed */}
          {activeItems.length === 0 && dismissedItems.length > 0 && (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-gray-500 font-medium mb-1">Nothing left to do.</p>
              <p className="text-xs text-gray-400">Your GM Agent is watching for new insights.</p>
            </div>
          )}

          {/* Dismissed toggle */}
          {dismissedItems.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <button
                onClick={() => setShowDismissed(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showDismissed
                  ? `Hide dismissed (${dismissedItems.length})`
                  : `Show dismissed (${dismissedItems.length})`}
              </button>

              {showDismissed && (
                <div className="mt-2 space-y-px">
                  {dismissedItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className="w-full text-left flex items-start gap-3 py-2.5 hover:bg-gray-50 transition-colors group"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 opacity-30"
                        style={{ backgroundColor: PRIORITY_CONFIG[item.priority].dot }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-400">{item.memberName}</p>
                        <p className="text-xs text-gray-300 truncate">{item.title}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
