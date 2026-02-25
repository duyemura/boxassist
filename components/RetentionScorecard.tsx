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
      <div className="border-b border-gray-100" style={{ backgroundColor: '#F4F5F7' }}>
        <div className="px-6 py-4 flex gap-8">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex-1">
              <div className="animate-pulse bg-gray-200 h-5 w-16 mb-1" />
              <div className="animate-pulse bg-gray-200 h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const needsAttention = data.conversationsActive + data.escalations

  const stats = [
    {
      label: 'MEMBERS RETAINED',
      value: data.membersRetained,
      color: '#16A34A',
    },
    {
      label: 'REVENUE SAVED',
      value: `$${data.revenueRetained.toLocaleString()}`,
      color: '#16A34A',
    },
    {
      label: 'CONVERSATIONS',
      value: data.conversationsActive,
      color: '#0063FF',
    },
    {
      label: 'NEEDS ATTENTION',
      value: needsAttention,
      color: needsAttention > 0 ? '#F59E0B' : '#9CA3AF',
    },
  ]

  return (
    <div className="border-b border-gray-100" style={{ backgroundColor: '#F4F5F7' }}>
      <div className="px-6 py-4 flex gap-8 overflow-x-auto">
        {stats.map(stat => (
          <div key={stat.label} className="flex-1 min-w-0">
            <p className="text-lg font-semibold" style={{ color: stat.color }}>
              {stat.value}
            </p>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mt-0.5">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
