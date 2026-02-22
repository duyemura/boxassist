'use client'

import { useEffect, useState } from 'react'

interface CommandBarProps {
  isDemo: boolean
  agents: any[]           // all agents
  scanning?: boolean      // a scan is literally running right now
  memberCount?: number
}

const DEMO_STATS = {
  totalAgents: 3,
  activeAgents: 1,
  totalRuns: 14,
  totalCostUsd: '3.40',
  totalValue: '1243',
  roi: 366,
}

// The agent "running right now" in demo
const DEMO_RUNNING_AGENTS = [
  { id: 'demo-1', name: 'At-Risk Monitor', membersScanned: 247, startedAt: '1h ago' },
]

function Skeleton() {
  return <div className="h-5 w-12 animate-pulse rounded bg-gray-200 inline-block" />
}

export default function CommandBar({ isDemo, agents, scanning, memberCount }: CommandBarProps) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isDemo) { setStats(DEMO_STATS); setLoading(false); return }
    fetch('/api/stats/roi')
      .then(r => r.json())
      .then(d => {
        setStats({
          totalAgents: agents.length,
          activeAgents: agents.filter((a: any) => a.active).length,
          totalRuns: d.totalRuns ?? 0,
          totalCostUsd: parseFloat(d.totalBilledUsd ?? '0').toFixed(2),
          totalValue: Math.round(parseFloat(d.totalValue ?? '0')).toString(),
          roi: d.roi ?? 0,
        })
      })
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [isDemo, agents])

  // Which agents are actually running right now
  const runningAgents: any[] = scanning
    ? (isDemo ? DEMO_RUNNING_AGENTS : agents.filter((a: any) => a.active).map((a: any) => ({ id: a.id, name: a.name, membersScanned: memberCount ?? 0 })))
    : []

  const roi = stats?.roi ?? 0
  const totalValue = stats?.totalValue ? `$${parseInt(stats.totalValue).toLocaleString()}` : '—'
  const roiStr = roi > 0 ? `${roi}x` : '—'
  const totalCost = stats?.totalCostUsd ? `$${stats.totalCostUsd}` : '—'
  const totalRuns = stats?.totalRuns ?? '—'

  return (
    <>
      {/* ── DESKTOP layout ─────────────────────────────────────────── */}
      {/*
        Sits above center+right rail as a single bar.
        Left zone (flex-1) = stats, aligns with center column.
        Right zone (w-96) = active agent status, aligns with right rail.
        Heights match so content below starts flush.
      */}
      <div
        className="hidden md:flex flex-shrink-0 border-b"
        style={{ backgroundColor: '#F4F5F7', borderBottomColor: '#E5E7EB' }}
      >
        {/* Stats zone — fills center column width */}
        <div className="flex flex-1 min-w-0 divide-x divide-gray-200">
          {/* Total Agents */}
          <div className="flex-1 min-w-0 px-5 py-4">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">Total Agents</p>
            {loading ? <Skeleton /> : <p className="text-lg font-bold text-gray-900">{stats?.totalAgents ?? 0}</p>}
            {!loading && <p className="text-[10px] text-gray-400">{stats?.activeAgents ?? 0} active</p>}
          </div>
          {/* Total Runs */}
          <div className="flex-1 min-w-0 px-5 py-4">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">Total Runs</p>
            {loading ? <Skeleton /> : <p className="text-lg font-bold text-gray-900">{totalRuns}</p>}
            {!loading && <p className="text-[10px] text-gray-400">last 30 days</p>}
          </div>
          {/* Agent Cost */}
          <div className="flex-1 min-w-0 px-5 py-4">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">Agent Cost</p>
            {loading ? <Skeleton /> : <p className="text-lg font-bold text-gray-900">{totalCost}</p>}
            {!loading && <p className="text-[10px] text-gray-400">billed this month</p>}
          </div>
          {/* Agent Value — value + ROI multiplier */}
          <div className="flex-1 min-w-0 px-5 py-4">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">Agent Value</p>
            {loading ? <Skeleton /> : (
              <div className="flex items-baseline gap-2">
                <p className="text-lg font-bold text-gray-900">{totalValue}</p>
                {roiStr !== '—' && (
                  <p className="text-sm font-bold" style={{ color: '#16a34a' }}>{roiStr}</p>
                )}
              </div>
            )}
            {!loading && <p className="text-[10px] text-gray-400">retained + saved</p>}
          </div>
        </div>

        {/* Report download */}
        <div className="flex items-center px-4 border-l border-gray-200 flex-shrink-0">
          <a
            href="/api/reports/monthly"
            download
            className="text-[10px] font-medium text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors whitespace-nowrap"
            title="Download monthly retention report PDF"
          >
            ↓ Report
          </a>
        </div>

        {/* Divider between stats and active zone */}
        <div className="w-px bg-gray-200 flex-shrink-0" />

        {/* Active agent zone — fixed width matching right rail (w-96 = 384px) */}
        <div className="w-96 flex-shrink-0 px-4 py-4 flex flex-col justify-center">
          {runningAgents.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
              <span className="text-xs text-gray-400">No agents running</span>
            </div>
          ) : runningAgents.length === 1 ? (
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: '#0063FF', boxShadow: '0 0 6px rgba(0,99,255,0.5)', animation: 'pulse 1.4s ease-in-out infinite' }}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900">{runningAgents[0].name}</p>
                <p className="text-[10px] text-gray-400">
                  Scanning {runningAgents[0].membersScanned > 0 ? `${runningAgents[0].membersScanned} members` : 'members'}…
                </p>
              </div>
            </div>
          ) : (
            // Multiple agents running
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1">{runningAgents.length} Running</p>
              {runningAgents.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: '#0063FF', animation: 'pulse 1.4s ease-in-out infinite' }}
                  />
                  <span className="text-xs text-gray-700 font-medium truncate">{a.name}</span>
                  {a.membersScanned > 0 && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{a.membersScanned} members</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── MOBILE layout ──────────────────────────────────────────── */}
      {/*
        Stacks vertically.
        Active agent status (if running) on top — compact banner.
        Stats row below — 2x2 grid, scrollable horizontally.
      */}
      <div className="md:hidden flex-shrink-0" style={{ backgroundColor: '#F4F5F7' }}>
        {/* Active agent banner — only shown when something is running */}
        {runningAgents.length > 0 && (
          <div
            className="flex items-center gap-2 px-4 py-2.5 border-b"
            style={{ borderBottomColor: '#E5E7EB' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: '#0063FF', boxShadow: '0 0 4px rgba(0,99,255,0.5)', animation: 'pulse 1.4s ease-in-out infinite' }}
            />
            <span className="text-xs font-medium text-gray-900">
              {runningAgents.length === 1
                ? `${runningAgents[0].name} scanning…`
                : `${runningAgents.length} agents scanning…`
              }
            </span>
          </div>
        )}

        {/* Stats — horizontal scroll on mobile */}
        <div className="flex overflow-x-auto divide-x divide-gray-200 border-b" style={{ borderBottomColor: '#E5E7EB' }}>
          <div className="flex-shrink-0 px-5 py-3 min-w-[80px]">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">Agents</p>
            {loading ? <div className="h-5 w-8 animate-pulse rounded bg-gray-200" /> : <p className="text-base font-bold text-gray-900">{stats?.totalAgents ?? 0}</p>}
          </div>
          <div className="flex-shrink-0 px-5 py-3 min-w-[80px]">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">Runs</p>
            {loading ? <div className="h-5 w-8 animate-pulse rounded bg-gray-200" /> : <p className="text-base font-bold text-gray-900">{totalRuns}</p>}
          </div>
          <div className="flex-shrink-0 px-5 py-3 min-w-[80px]">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">Cost</p>
            {loading ? <div className="h-5 w-10 animate-pulse rounded bg-gray-200" /> : <p className="text-base font-bold text-gray-900">{totalCost}</p>}
          </div>
          <div className="flex-shrink-0 px-5 py-3 min-w-[100px]">
            <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">Value</p>
            {loading ? <div className="h-5 w-12 animate-pulse rounded bg-gray-200" /> : (
              <div className="flex items-baseline gap-1.5">
                <p className="text-base font-bold text-gray-900">{totalValue}</p>
                {roiStr !== '—' && <p className="text-xs font-bold" style={{ color: '#16a34a' }}>{roiStr}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
