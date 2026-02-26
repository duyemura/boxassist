'use client'

/**
 * People page — shows everyone the agent has flagged, with AI-generated context.
 *
 * No hardcoded domain columns (no "Last Check-in", "Risk Level").
 * Renders what the AI surfaced: priority, detail, type badge, status, outcome.
 * Filter tabs are status-based (universal), not business-specific categories.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'

// ── Types ────────────────────────────────────────────────────────────────────

interface PersonRow {
  id: string
  name: string
  email: string
  priority: string
  status: string
  outcome: string | null
  taskType: string
  title: string | null
  detail: string | null
  recommendedAction: string | null
  estimatedImpact: string | null
  createdAt: string
  updatedAt: string
}

type FilterTab = 'all' | 'needs_attention' | 'active' | 'resolved'

// ── Priority colors ──────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444',
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#9CA3AF',
}

// ── Status labels — universal task statuses, not domain-specific ─────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'Pending', color: '#6B7280' },
  awaiting_approval: { label: 'Needs Approval', color: '#F59E0B' },
  awaiting_reply: { label: 'In Conversation', color: '#0063FF' },
  in_progress: { label: 'In Progress', color: '#0063FF' },
  resolved: { label: 'Resolved', color: '#16A34A' },
  escalated: { label: 'Escalated', color: '#F59E0B' },
  cancelled: { label: 'Skipped', color: '#9CA3AF' },
}

// ── Outcome badges ───────────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  engaged: { label: 'Retained', color: '#16A34A' },
  recovered: { label: 'Won Back', color: '#16A34A' },
  churned: { label: 'Lost', color: '#EF4444' },
  unresponsive: { label: 'No Response', color: '#9CA3AF' },
  not_applicable: { label: 'N/A', color: '#9CA3AF' },
}

// ── Type badge — keyword matching (same approach as ActionSlidePanel) ────────

const BADGE_RULES: Array<{
  keywords: string[]
  label: string
  color: string
  bg: string
}> = [
  { keywords: ['payment', 'billing', 'invoice'], label: 'Payment', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
  { keywords: ['churn', 'at_risk', 'at-risk', 'attendance_drop', 'disengag'], label: 'At Risk', color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
  { keywords: ['renewal', 'expir'], label: 'Renewal', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
  { keywords: ['win_back', 'winback', 'cancel', 'lapsed', 'reactivat'], label: 'Win-Back', color: '#0063FF', bg: 'rgba(0,99,255,0.08)' },
  { keywords: ['lead', 'prospect', 'trial', 'cold'], label: 'Lead', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
  { keywords: ['onboard', 'new_member', 'welcome'], label: 'Onboarding', color: '#22C55E', bg: 'rgba(34,197,94,0.08)' },
  { keywords: ['no_show', 'noshow', 'missed'], label: 'No-Show', color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
]

function getTypeBadge(taskType: string, priority: string): { label: string; color: string; bg: string } | null {
  if (!taskType) return null
  const haystack = taskType.toLowerCase()
  for (const rule of BADGE_RULES) {
    if (rule.keywords.some(kw => haystack.includes(kw))) return rule
  }
  // Fallback: format the type string as a label
  const label = taskType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  if (priority === 'critical' || priority === 'high') {
    return { label, color: '#EF4444', bg: 'rgba(239,68,68,0.08)' }
  }
  return { label, color: '#6B7280', bg: 'rgba(107,114,128,0.08)' }
}

// ── Relative time ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PeoplePage() {
  const [people, setPeople] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')

  useEffect(() => {
    fetch('/api/retention/members')
      .then(r => r.json())
      .then(data => {
        setPeople(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Filter tabs based on universal task status — not business-specific categories
  const filtered = people.filter(p => {
    switch (filter) {
      case 'needs_attention':
        return ['open', 'awaiting_approval', 'escalated'].includes(p.status)
      case 'active':
        return ['awaiting_reply', 'in_progress'].includes(p.status)
      case 'resolved':
        return p.status === 'resolved' || p.status === 'cancelled'
      default:
        return true
    }
  })

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: people.length },
    { id: 'needs_attention', label: 'Needs Attention', count: people.filter(p => ['open', 'awaiting_approval', 'escalated'].includes(p.status)).length },
    { id: 'active', label: 'Active', count: people.filter(p => ['awaiting_reply', 'in_progress'].includes(p.status)).length },
    { id: 'resolved', label: 'Resolved', count: people.filter(p => p.status === 'resolved' || p.status === 'cancelled').length },
  ]

  return (
    <DashboardShell activeSection="members">
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
              People
            </h1>
            {!loading && (
              <span className="text-xs text-gray-400">{people.length} total</span>
            )}
          </div>
        </div>

        {/* Filter tabs — status-based, not domain-specific */}
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
              {tab.count > 0 && (
                <span className="ml-1 text-[10px] opacity-60">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-6 py-4 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="animate-pulse flex items-center gap-4 py-3">
                  <div className="w-1.5 h-1.5 bg-gray-200" style={{ borderRadius: '50%' }} />
                  <div className="flex-1">
                    <div className="h-3 bg-gray-200 w-32 mb-2" />
                    <div className="h-2 bg-gray-100 w-64" />
                  </div>
                  <div className="h-4 bg-gray-100 w-16" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-gray-500 font-medium mb-1">No one matches this filter</p>
              <p className="text-xs text-gray-400">
                {filter === 'all'
                  ? 'Run an analysis to find people who need attention.'
                  : 'Try a different filter to see more people.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map(p => {
                const statusInfo = p.status ? STATUS_LABELS[p.status] : null
                const outcomeInfo = p.outcome ? OUTCOME_LABELS[p.outcome] : null
                const badge = getTypeBadge(p.taskType, p.priority)
                const dotColor = PRIORITY_COLORS[p.priority] ?? '#9CA3AF'

                return (
                  <div key={p.id} className="px-6 py-3.5 hover:bg-gray-50 transition-colors">
                    {/* Row 1: Priority dot + name + type badge + status/outcome + time */}
                    <div className="flex items-center gap-2.5 mb-1">
                      <span
                        className="w-1.5 h-1.5 flex-shrink-0"
                        style={{ backgroundColor: dotColor, borderRadius: '50%' }}
                      />
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {p.name}
                      </span>
                      {badge && (
                        <span
                          className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 flex-shrink-0"
                          style={{ color: badge.color, backgroundColor: badge.bg }}
                        >
                          {badge.label}
                        </span>
                      )}
                      <span className="flex-1" />
                      {p.estimatedImpact && (
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {p.estimatedImpact}
                        </span>
                      )}
                      {outcomeInfo ? (
                        <span
                          className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 flex-shrink-0"
                          style={{ backgroundColor: `${outcomeInfo.color}12`, color: outcomeInfo.color }}
                        >
                          {outcomeInfo.label}
                        </span>
                      ) : statusInfo ? (
                        <span
                          className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 flex-shrink-0"
                          style={{ backgroundColor: `${statusInfo.color}12`, color: statusInfo.color }}
                        >
                          {statusInfo.label}
                        </span>
                      ) : null}
                    </div>

                    {/* Row 2: AI-generated title or detail */}
                    {(p.title || p.detail) && (
                      <p className="text-xs text-gray-500 truncate ml-4 mb-0.5">
                        {p.title ?? p.detail}
                      </p>
                    )}

                    {/* Row 3: email + relative time */}
                    <div className="flex items-center gap-2 ml-4">
                      {p.email && (
                        <span className="text-[10px] text-gray-400 truncate">{p.email}</span>
                      )}
                      <span className="flex-1" />
                      <span className="text-[10px] text-gray-300 flex-shrink-0">
                        {relativeTime(p.updatedAt ?? p.createdAt)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
