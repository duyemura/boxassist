'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface GymActivity {
  id: string
  event_type: string
  payload: Record<string, unknown>
  processed_at: string | null
  agent_runs_triggered: number
  created_at: string
}

const ACTIVITY_ICONS: Record<string, string> = {
  'customer.created': '🎉',
  'customer.status.changed': '🔄',
  'customer.deleted': '👋',
  'enrollment.created': '✅',
  'enrollment.status.changed': '🔄',
  'enrollment.deleted': '❌',
  'checkin.created': '🏋️',
  'checkin.updated': '🏋️',
  'checkin.deleted': '↩️',
  'appointment.scheduled': '📅',
  'appointment.rescheduled': '📅',
  'appointment.canceled': '❌',
  'appointment.noshowed': '🚫',
  'reservation.created': '🎯',
  'reservation.canceled': '↩️',
  'reservation.waitlisted': '⏳',
  'reservation.noshowed': '🚫',
  'class.canceled': '❌',
  'memberapp.updated': '📱',
}

const ACTIVITY_LABELS: Record<string, string> = {
  'customer.created': 'New member joined',
  'customer.status.changed': 'Member status changed',
  'customer.deleted': 'Member left',
  'enrollment.created': 'Member enrolled',
  'enrollment.status.changed': 'Enrollment changed',
  'enrollment.deleted': 'Enrollment ended',
  'checkin.created': 'Someone checked in',
  'checkin.updated': 'Check-in updated',
  'checkin.deleted': 'Check-in removed',
  'appointment.scheduled': 'Appointment booked',
  'appointment.rescheduled': 'Appointment moved',
  'appointment.canceled': 'Appointment canceled',
  'appointment.noshowed': 'No-show',
  'reservation.created': 'Class spot reserved',
  'reservation.canceled': 'Reservation canceled',
  'reservation.waitlisted': 'Added to waitlist',
  'reservation.noshowed': 'No-show for class',
  'class.canceled': 'Class canceled',
  'memberapp.updated': 'Member app updated',
}

const ACTIVITY_COLORS: Record<string, string> = {
  'customer.created': 'bg-green-100 text-green-700',
  'enrollment.created': 'bg-blue-100 text-blue-700',
  'checkin.created': 'bg-gray-100 text-gray-700',
  'appointment.scheduled': 'bg-blue-100 text-blue-700',
  'appointment.canceled': 'bg-red-100 text-red-700',
  'reservation.created': 'bg-blue-100 text-blue-700',
  'reservation.canceled': 'bg-red-100 text-red-700',
  'customer.status.changed': 'bg-amber-100 text-amber-700',
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

export default function ActivityPage() {
  const router = useRouter()
  const [activities, setActivities] = useState<GymActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/events')
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json()
      setActivities(data.events ?? [])
    } catch {}
    setLoading(false)
  }, [router])

  useEffect(() => {
    fetchActivities()
    const interval = setInterval(fetchActivities, 15_000)
    return () => clearInterval(interval)
  }, [fetchActivities])

  const filtered = filter === 'all' ? activities : activities.filter(a => a.event_type === filter)
  const activityTypes = Array.from(new Set(activities.map(a => a.event_type)))

  const todayCount = activities.filter(a => new Date(a.created_at) > new Date(Date.now() - 86_400_000)).length
  const helpersResponded = activities.reduce((sum, a) => sum + (a.agent_runs_triggered ?? 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-700  flex items-center justify-center">
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="font-bold text-gray-900">GymAgents</span>
            </Link>
            <span className="text-gray-300">|</span>
            <span className="text-gray-600 text-sm font-medium">Activity</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={fetchActivities} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              ↻ Refresh
            </button>
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-700 text-sm">← Dashboard</Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">What's been happening</h1>
          <p className="text-gray-500 text-sm">Everything going on at your gym, as it happens.</p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white  border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{todayCount}</div>
            <div className="text-xs text-gray-500 mt-1">Today</div>
          </div>
          <div className="bg-white  border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{activities.length}</div>
            <div className="text-xs text-gray-500 mt-1">Past 30 days</div>
          </div>
          <div className="bg-white  border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{helpersResponded}</div>
            <div className="text-xs text-gray-500 mt-1">Your helpers responded</div>
          </div>
        </div>

        {/* Filters */}
        {activityTypes.length > 0 && (
          <div className="flex gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`text-sm font-medium px-4 py-2 rounded-full transition-colors ${
                filter === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
              }`}
            >
              Everything
            </button>
            {activityTypes.map(type => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`text-sm font-medium px-4 py-2 rounded-full transition-colors ${
                  filter === type ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {ACTIVITY_ICONS[type]} {ACTIVITY_LABELS[type] ?? type}
              </button>
            ))}
          </div>
        )}

        {/* Activity feed */}
        {loading ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-gray-400">Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white  border border-gray-200 p-12 text-center">
            <div className="text-5xl mb-4">📭</div>
            <h3 className="font-bold text-gray-900 text-lg mb-2">Nothing yet</h3>
            <p className="text-gray-500 text-sm max-w-sm mx-auto">
              Once your gym is connected to PushPress, everything that happens in your gym will show up here — new members, check-ins, bookings, and more.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(activity => {
              const isExpanded = expandedId === activity.id
              const data = (activity.payload?.data ?? activity.payload?.object ?? {}) as Record<string, unknown>
              const name =
                (data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : null) ??
                (data.name as string) ??
                (data.email as string) ??
                null

              return (
                <div key={activity.id} className="bg-white  border border-gray-200 overflow-hidden">
                  <div
                    className="p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : activity.id)}
                  >
                    <div className="text-2xl w-9 text-center flex-shrink-0">
                      {ACTIVITY_ICONS[activity.event_type] ?? '📌'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          ACTIVITY_COLORS[activity.event_type] ?? 'bg-gray-100 text-gray-600'
                        }`}>
                          {ACTIVITY_LABELS[activity.event_type] ?? activity.event_type}
                        </span>
                        {activity.agent_runs_triggered > 0 && (
                          <span className="text-xs text-blue-500 font-medium">
                            · your helper responded
                          </span>
                        )}
                      </div>
                      {name && <div className="text-sm text-gray-900 font-medium truncate">{name}</div>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-gray-400">{timeAgo(activity.created_at)}</span>
                      {activity.processed_at
                        ? <span className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-xs font-bold">✓</span>
                        : <span className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-gray-300 text-xs">○</span>
                      }
                      <span className="text-gray-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 p-4 bg-gray-50">
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Details</p>
                          <div className="space-y-1 text-xs text-gray-700">
                            {name && <div><span className="text-gray-400 w-20 inline-block">Who:</span>{name}</div>}
                            {(data.email as string) && <div><span className="text-gray-400 w-20 inline-block">Email:</span>{data.email as string}</div>}
                            <div><span className="text-gray-400 w-20 inline-block">When:</span>{new Date(activity.created_at).toLocaleString()}</div>
                            {activity.agent_runs_triggered > 0 && (
                              <div><span className="text-gray-400 w-20 inline-block">Response:</span>Your helper took action</div>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Raw data</p>
                          <pre className="text-xs text-gray-600 bg-white  p-3 border border-gray-100 overflow-auto max-h-32">
                            {JSON.stringify(data, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
