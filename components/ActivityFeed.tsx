'use client'

import { useEffect, useState } from 'react'

interface ActivityItem {
  id: string
  type: 'outreach' | 'reply' | 'followup' | 'retained' | 'churned' | 'escalated' | 'system'
  memberName: string
  detail: string
  outcome: string | null
  createdAt: string
}

const OUTCOME_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  engaged: { bg: 'rgba(22,163,74,0.08)', text: '#16A34A', label: 'Retained' },
  recovered: { bg: 'rgba(22,163,74,0.08)', text: '#16A34A', label: 'Recovered' },
  churned: { bg: 'rgba(239,68,68,0.08)', text: '#EF4444', label: 'Churned' },
  escalated: { bg: 'rgba(245,158,11,0.08)', text: '#F59E0B', label: 'Escalated' },
}

const TYPE_ICONS: Record<string, string> = {
  outreach: '→',
  reply: '←',
  followup: '→',
  retained: '✓',
  churned: '×',
  escalated: '!',
  system: '·',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/retention/activity')
      .then(r => r.json())
      .then(data => {
        setItems(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="px-4 py-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <div className="w-6 h-6 bg-gray-200" />
              <div className="flex-1">
                <div className="h-3 bg-gray-200 w-3/4 mb-1" />
                <div className="h-2 bg-gray-200 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-xs text-gray-400">No activity yet. Run an analysis to get started.</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-4">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">
        RECENT ACTIVITY
      </p>
      <div className="space-y-3">
        {items.map(item => {
          const outcomeStyle = item.outcome ? OUTCOME_STYLES[item.outcome] : null

          return (
            <div key={item.id} className="flex gap-3 items-start">
              {/* Icon */}
              <span
                className="w-6 h-6 flex items-center justify-center text-xs font-medium flex-shrink-0"
                style={{
                  backgroundColor: outcomeStyle?.bg ?? '#F3F4F6',
                  color: outcomeStyle?.text ?? '#6B7280',
                }}
              >
                {TYPE_ICONS[item.type] ?? '·'}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-relaxed">
                  {item.detail}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-400">
                    {timeAgo(item.createdAt)}
                  </span>
                  {outcomeStyle && (
                    <span
                      className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5"
                      style={{ backgroundColor: outcomeStyle.bg, color: outcomeStyle.text }}
                    >
                      {outcomeStyle.label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
