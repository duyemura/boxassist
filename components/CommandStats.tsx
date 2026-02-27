'use client'

import { useEffect, useState } from 'react'

interface CommandStatsProps {
  activeAgents: number
  pendingCount: number
  lastRunAt: string | null
  isDemo?: boolean
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function CommandStats({ activeAgents, pendingCount, lastRunAt, isDemo }: CommandStatsProps) {
  const [retained, setRetained] = useState<number | null>(null)
  const [revenue, setRevenue] = useState<number | null>(null)

  useEffect(() => {
    if (isDemo) {
      setRetained(3)
      setRevenue(486)
      return
    }
    fetch('/api/retention/scorecard')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json) {
          setRetained(json.membersRetained ?? 0)
          setRevenue(json.revenueRetained ?? 0)
        }
      })
      .catch(() => {})
  }, [isDemo])

  const stats: Array<{ label: string; value: string; color?: string }> = [
    {
      label: 'Agents',
      value: activeAgents.toString(),
      color: activeAgents > 0 ? '#111827' : undefined,
    },
    {
      label: 'Pending',
      value: pendingCount.toString(),
      color: pendingCount > 0 ? '#F59E0B' : undefined,
    },
    {
      label: 'Retained',
      value: retained !== null ? retained.toString() : '—',
      color: retained !== null && retained > 0 ? '#16A34A' : undefined,
    },
    {
      label: 'Revenue Saved',
      value: revenue !== null ? `$${revenue.toLocaleString()}` : '—',
      color: revenue !== null && revenue > 0 ? '#16A34A' : undefined,
    },
    {
      label: 'Last Run',
      value: timeAgo(lastRunAt),
    },
  ]

  return (
    <div className="w-full border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: '#F4F5F7' }}>
      <div className="flex items-center px-6 py-3">
        {stats.map((s, i) => (
          <div key={s.label} className="flex-1 flex items-center gap-3">
            {i > 0 && <div className="w-px h-8 bg-gray-200 mr-3 flex-shrink-0" />}
            <div>
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-0.5">
                {s.label}
              </p>
              <p className="text-lg font-semibold" style={{ color: s.color ?? '#111827' }}>
                {s.value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
