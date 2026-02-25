'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface MemberRow {
  id: string
  name: string
  email: string
  riskLevel: string
  lastCheckin: string | null
  status: string | null
  outcome: string | null
}

type FilterTab = 'all' | 'at_risk' | 'active' | 'retained'

const RISK_COLORS: Record<string, string> = {
  high: '#EF4444',
  critical: '#EF4444',
  medium: '#F59E0B',
  low: '#9CA3AF',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'Pending', color: '#6B7280' },
  awaiting_approval: { label: 'Needs Approval', color: '#F59E0B' },
  awaiting_reply: { label: 'In Conversation', color: '#0063FF' },
  in_progress: { label: 'In Progress', color: '#0063FF' },
  resolved: { label: 'Resolved', color: '#16A34A' },
  escalated: { label: 'Escalated', color: '#F59E0B' },
  cancelled: { label: 'Skipped', color: '#9CA3AF' },
}

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')

  useEffect(() => {
    fetch('/api/retention/members')
      .then(r => r.json())
      .then(data => {
        setMembers(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = members.filter(m => {
    switch (filter) {
      case 'at_risk': return ['open', 'awaiting_approval', 'awaiting_reply', 'in_progress', 'escalated'].includes(m.status ?? '')
      case 'active': return m.status === 'awaiting_reply' || m.status === 'in_progress'
      case 'retained': return m.outcome === 'engaged' || m.outcome === 'recovered'
      default: return true
    }
  })

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'at_risk', label: 'At Risk' },
    { id: 'active', label: 'Active' },
    { id: 'retained', label: 'Retained' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-lg font-semibold" style={{ color: '#080808' }}>
            Members
          </h1>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-6 py-2 flex gap-1 border-b border-gray-100">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className="text-xs font-semibold px-3 py-1.5 transition-opacity hover:opacity-80"
            style={{
              backgroundColor: filter === tab.id ? '#EEF5FF' : 'transparent',
              color: filter === tab.id ? '#0063FF' : '#6B7280',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-6 py-4 space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="animate-pulse flex items-center gap-4">
                <div className="w-1.5 h-1.5 bg-gray-200" style={{ borderRadius: '50%' }} />
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 w-32 mb-1" />
                  <div className="h-2 bg-gray-200 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-gray-500">No members match this filter.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(m => {
              const statusInfo = m.status ? STATUS_LABELS[m.status] : null

              return (
                <div key={m.id} className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                  {/* Risk dot */}
                  <span
                    className="w-1.5 h-1.5 flex-shrink-0"
                    style={{
                      backgroundColor: RISK_COLORS[m.riskLevel] ?? '#9CA3AF',
                      borderRadius: '50%',
                    }}
                  />

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{m.email}</p>
                  </div>

                  {/* Last checkin */}
                  {m.lastCheckin && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                      {m.lastCheckin}
                    </span>
                  )}

                  {/* Status badge */}
                  {statusInfo && (
                    <span
                      className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 flex-shrink-0"
                      style={{
                        backgroundColor: `${statusInfo.color}12`,
                        color: statusInfo.color,
                      }}
                    >
                      {statusInfo.label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
