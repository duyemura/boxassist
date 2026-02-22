'use client'

import { useState, useEffect } from 'react'

interface DashboardData {
  user?: any
  gym?: any
  tier?: string
  isDemo?: boolean
  autopilots?: any[]
  recentRuns?: any[]
  pendingActions?: any[]
  monthlyRunCount?: number
  recentEvents?: Array<{
    id: string
    event_type: string
    created_at: string
    agent_runs_triggered: number
    processed_at: string | null
  }>
}

interface FleetOverviewProps {
  data: DashboardData | null
  isDemo: boolean
  isSandboxDemo: boolean
}

interface RoiStats {
  period: string
  totalRuns: number
  totalMessages: number
  totalCostUsd: string
  totalBilledUsd: string
  totalTimeSavedMin: number
  timeSavedDollars: string
  revenueRetained: string
  membersSaved: number
  cacAvoided: string
  totalValue: string
  roi: number
  actionsTotal: number
  actionsPending: number
}

function fmt(n: string | number): string {
  const val = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(val)) return '—'
  return Math.round(val).toLocaleString()
}

function fmtDollar(n: string | number): string {
  return `$${fmt(n)}`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

const ACTIVITY_LABELS: Record<string, string> = {
  'customer.created': 'New member joined',
  'enrollment.created': 'Member enrolled',
  'checkin.created': 'Check-in',
  'appointment.scheduled': 'Appointment booked',
  'appointment.canceled': 'Appointment canceled',
  'reservation.created': 'Class reserved',
  'reservation.canceled': 'Reservation canceled',
  'customer.status.changed': 'Member status changed',
}

const DEMO_ACTIVITY = [
  { label: 'At-Risk Monitor scanned 247 members', time: '1h ago', agent: true },
  { label: 'Sarah Chen flagged — 19 days absent', time: '1h ago', agent: true },
  { label: 'Derek Walsh flagged — renewal in 12 days', time: '1h ago', agent: true },
]

export default function FleetOverview({ data, isDemo, isSandboxDemo }: FleetOverviewProps) {
  const [roi, setRoi] = useState<RoiStats | null>(null)

  useEffect(() => {
    fetch('/api/stats/roi')
      .then(r => r.json())
      .then(setRoi)
      .catch(() => {})
  }, [])

  const memberCount = data?.gym?.member_count ?? data?.gym?.memberCount ?? 0
  const pendingCount = data?.pendingActions?.length ?? 0
  const recentRuns = data?.recentRuns ?? []

  // Numbers from ROI API (falls back to dashes while loading)
  const totalValueDisplay = roi ? fmtDollar(roi.totalValue) : '—'
  const roiDisplay = roi ? `${roi.roi}x` : '—'
  const retainedDisplay = roi ? fmtDollar(roi.revenueRetained) : '—'
  const cacDisplay = roi ? fmtDollar(roi.cacAvoided) : '—'
  const timeSavedDisplay = roi ? fmtDollar(roi.timeSavedDollars) : '—'
  const agentCostDisplay = roi ? `$${parseFloat(roi.totalBilledUsd).toFixed(2)}` : '—'

  return (
    <div className="flex flex-col h-full">
      {/* Section header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase">Fleet overview</p>
      </div>

      {/* 2x2 stats grid */}
      <div className="grid grid-cols-2 gap-px bg-gray-100 border-b border-gray-100">
        <div className="bg-white px-4 py-4">
          <p className="text-xs text-gray-400 mb-1">Members watched</p>
          <p className="text-xl font-semibold text-gray-900">
            {memberCount > 0 ? String(memberCount) : '—'}
          </p>
        </div>
        <div className="bg-white px-4 py-4">
          <p className="text-xs text-gray-400 mb-1">At risk this week</p>
          <p className="text-xl font-semibold text-gray-900">
            {pendingCount > 0 ? String(pendingCount) : roi ? String(roi.actionsPending) : '—'}
          </p>
        </div>
        <div className="bg-white px-4 py-4">
          <p className="text-xs text-gray-400 mb-1">Saved this month</p>
          <p className="text-xl font-semibold text-gray-900">
            {roi ? String(roi.membersSaved) : '—'}
          </p>
        </div>
        <div className="bg-white px-4 py-4">
          <p className="text-xs text-gray-400 mb-1">Est. value retained</p>
          <p className="text-xl font-semibold text-gray-900">{retainedDisplay}</p>
        </div>
      </div>

      {/* ROI highlight — the main value block */}
      <div className="px-4 py-4 border-b border-gray-100">
        {/* Total value + ROI multiplier */}
        <p className="text-xs text-gray-400 mb-1">Total value this month</p>
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-3xl font-bold text-gray-900">{totalValueDisplay}</span>
          <span
            className="text-xl font-bold"
            style={{ color: '#62FB84', textShadow: '0 0 12px rgba(98,251,132,0.5)' }}
          >
            {roiDisplay}
          </span>
        </div>

        {/* Three sub-stat columns */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{retainedDisplay}</p>
            <p className="text-xs text-gray-400">Retained</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{cacDisplay}</p>
            <p className="text-xs text-gray-400">CAC avoided</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{timeSavedDisplay}</p>
            <p className="text-xs text-gray-400">Time saved</p>
          </div>
        </div>

        {/* Agent cost footer */}
        <div className="space-y-0.5">
          <p className="text-xs text-gray-400">
            Agent cost: {agentCostDisplay}
          </p>
          {roi && (
            <p className="text-xs text-gray-400">
              {roi.totalRuns} runs · {roi.totalMessages} messages
            </p>
          )}
          {roi && (
            <p className="text-xs text-gray-400">
              {roi.membersSaved} members saved · {roi.actionsPending} pending
            </p>
          )}
        </div>
      </div>

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Recent scans</p>
          <div className="space-y-2">
            {recentRuns.slice(0, 3).map((run: any) => (
              <div key={run.id} className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-gray-200 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-1 truncate">
                  {run.output?.summary ?? 'Scan completed'}
                </span>
                <span className="text-xs text-gray-300 flex-shrink-0">
                  {run.created_at ? timeAgo(run.created_at) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Demo recent activity */}
      {isDemo && (
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Recent activity</p>
          <div className="space-y-2">
            {DEMO_ACTIVITY.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-gray-200 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-1 truncate">{item.label}</span>
                <span className="text-xs text-gray-300 flex-shrink-0">{item.time}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-300 mt-3 italic">Sample activity</p>
        </div>
      )}

      {/* Real recent events */}
      {!isDemo && data?.recentEvents && data.recentEvents.length > 0 && (
        <div className="px-4 py-4">
          <p className="text-xs font-semibold tracking-widest text-gray-400 uppercase mb-3">Recent activity</p>
          <div className="space-y-2">
            {data.recentEvents.slice(0, 3).map((event) => (
              <div key={event.id} className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-gray-200 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-1 truncate">
                  {ACTIVITY_LABELS[event.event_type] ?? event.event_type}
                  {event.agent_runs_triggered > 0 && (
                    <span className="ml-1.5 text-gray-300">· agent responded</span>
                  )}
                </span>
                <span className="text-xs text-gray-300 flex-shrink-0">
                  {timeAgo(event.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isDemo && recentRuns.length === 0 && (!data?.recentEvents || data.recentEvents.length === 0) && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-1">No activity yet.</p>
            <p className="text-xs text-gray-300">Run a scan to see results here.</p>
          </div>
        </div>
      )}
    </div>
  )
}
