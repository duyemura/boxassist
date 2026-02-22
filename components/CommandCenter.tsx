'use client'

import { useEffect, useState } from 'react'

interface CommandCenterProps {
  isDemo: boolean
  isSandboxDemo: boolean
  agents: any[]
}

interface StatTileProps {
  label: string
  value: string
  sub?: string
  accent?: boolean
  loading?: boolean
}

function StatTile({ label, value, sub, accent, loading }: StatTileProps) {
  return (
    <div className="flex-1 min-w-0 px-6 py-4 border-r border-gray-200 last:border-r-0">
      <p className="text-[10px] font-semibold tracking-widest uppercase mb-1.5 text-gray-400">
        {label}
      </p>
      {loading ? (
        <div className="h-6 w-14 animate-pulse rounded bg-gray-200" />
      ) : (
        <p
          className="text-xl font-bold tracking-tight"
          style={{ color: accent ? '#16a34a' : '#111827' }}
        >
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className="text-xs mt-0.5 text-gray-400">{sub}</p>
      )}
    </div>
  )
}

const DEMO_STATS = {
  totalAgents: 3,
  activeAgents: 1,
  totalRuns: 14,
  totalCostUsd: '3.40',
  totalValue: '1243',
  roi: 366,
}

export default function CommandCenter({ isDemo, isSandboxDemo, agents }: CommandCenterProps) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isDemo) {
      setStats(DEMO_STATS)
      setLoading(false)
      return
    }
    fetch('/api/stats/roi')
      .then(r => r.json())
      .then(d => {
        setStats({
          totalAgents: agents.length,
          activeAgents: agents.filter(a => a.active).length,
          totalRuns: d.totalRuns ?? 0,
          totalCostUsd: parseFloat(d.totalBilledUsd ?? '0').toFixed(2),
          totalValue: Math.round(parseFloat(d.totalValue ?? '0')).toString(),
          roi: d.roi ?? 0,
        })
        setLoading(false)
      })
      .catch(() => {
        setStats({
          totalAgents: agents.length,
          activeAgents: agents.filter(a => a.active).length,
          totalRuns: 0,
          totalCostUsd: '0.00',
          totalValue: '0',
          roi: 0,
        })
        setLoading(false)
      })
  }, [isDemo, agents])

  const tiles = [
    {
      label: 'Agents',
      value: loading ? '—' : `${stats?.activeAgents ?? 0} / ${stats?.totalAgents ?? 0}`,
      sub: 'active / total',
    },
    {
      label: 'Total Runs',
      value: loading ? '—' : String(stats?.totalRuns ?? 0),
      sub: 'last 30 days',
    },
    {
      label: 'Total Cost',
      value: loading ? '—' : `$${stats?.totalCostUsd ?? '0.00'}`,
      sub: 'agent spend',
    },
    {
      label: 'Value Generated',
      value: loading ? '—' : `$${stats?.totalValue ?? '0'}`,
      sub: 'retained + saved',
    },
    {
      label: 'ROI',
      value: loading ? '—' : stats?.roi > 0 ? `${stats.roi}x` : '—',
      sub: 'return on agent spend',
      accent: true,
    },
  ]

  return (
    <div
      className="flex border-b"
      style={{ backgroundColor: '#F0F2F5', borderBottomColor: '#E5E7EB' }}
    >
      {tiles.map((tile, i) => (
        <StatTile
          key={i}
          label={tile.label}
          value={tile.value}
          sub={tile.sub}
          accent={tile.accent}
          loading={loading}
        />
      ))}
    </div>
  )
}
