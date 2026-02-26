'use client'

import { useEffect, useState } from 'react'

interface ScorecardData {
  tasksCreated: number
  messagesSent: number
  membersRetained: number
  revenueRetained: number
  membersChurned: number
  conversationsActive: number
  escalations: number
}

export default function RetentionScorecard() {
  const [data, setData] = useState<ScorecardData | null>(null)

  useEffect(() => {
    fetch('/api/retention/scorecard')
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data) {
    return (
      <div className="w-full border-b border-gray-200" style={{ backgroundColor: '#F4F5F7' }}>
        <div className="flex items-center gap-8 px-6 py-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-1">
              <div className="animate-pulse bg-gray-200 h-3 w-16 mb-1.5" />
              <div className="animate-pulse bg-gray-200 h-5 w-10" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const needsAttention = data.escalations + data.conversationsActive
  const costEstimate = ((data.messagesSent * 0.003) + (data.tasksCreated * 0.001)).toFixed(2)

  const stats: Array<{ label: string; value: string; color?: string }> = [
    {
      label: 'RETAINED',
      value: data.membersRetained.toString(),
      color: data.membersRetained > 0 ? '#16A34A' : undefined,
    },
    {
      label: 'REVENUE SAVED',
      value: `$${data.revenueRetained.toLocaleString()}`,
      color: data.revenueRetained > 0 ? '#16A34A' : undefined,
    },
    {
      label: 'ACTIVE',
      value: data.conversationsActive.toString(),
      color: data.conversationsActive > 0 ? '#0063FF' : undefined,
    },
    {
      label: 'COST',
      value: `$${costEstimate}`,
    },
    {
      label: 'ATTENTION',
      value: needsAttention.toString(),
      color: needsAttention > 0 ? '#F59E0B' : undefined,
    },
  ]

  return (
    <div className="w-full border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: '#F4F5F7' }}>
      <div className="flex items-center px-6 py-3">
        {stats.map((s, i) => (
          <div key={s.label} className="flex-1 flex items-center gap-3">
            {i > 0 && <div className="w-px h-8 bg-gray-200 mr-3" />}
            <div>
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-0.5">
                {s.label}
              </p>
              <p
                className="text-lg font-semibold"
                style={{ color: s.color ?? '#111827' }}
              >
                {s.value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
