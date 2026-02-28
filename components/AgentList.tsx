'use client'

import { useState, useRef, useEffect } from 'react'

interface Agent {
  id: string
  name: string
  description?: string
  skill_type: string
  is_active: boolean
  trigger_mode: string
  cron_schedule?: string
  trigger_event?: string
  last_run_at?: string
  run_count?: number
  system_prompt?: string | null
  created_at?: string
}

interface AgentListProps {
  agents: Agent[]
  isDemo?: boolean
  onSelect?: (agent: Agent) => void
  onToggle?: (skillType: string, isActive: boolean) => void
  onDelete?: (agentId: string) => void
}

function timeAgo(dateStr?: string): string {
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

function shortDate(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function triggerLabel(agent: Agent): string {
  if (agent.trigger_mode === 'event') {
    return 'On event'
  }
  if (agent.cron_schedule === 'daily') return 'Daily'
  if (agent.cron_schedule === 'weekly') return 'Weekly'
  if (agent.cron_schedule === 'hourly') return 'Hourly'
  return agent.cron_schedule || 'Scheduled'
}

/**
 * Number duplicate agent names so they're distinguishable.
 * "Lead Re-Activation" x3 → "Lead Re-Activation", "Lead Re-Activation #2", "Lead Re-Activation #3"
 * Ordered by created_at ascending (oldest = no suffix).
 */
function numberAgentNames(agents: Agent[]): Map<string, string> {
  const nameCounts = new Map<string, number>()
  for (const a of agents) {
    nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1)
  }

  const nameIndexes = new Map<string, number>()
  const result = new Map<string, string>()

  // Process in created_at order (oldest first) so #1 is implicit (no suffix)
  const sorted = [...agents].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? '')
  )

  for (const a of sorted) {
    const count = nameCounts.get(a.name) ?? 1
    if (count <= 1) {
      result.set(a.id, a.name)
    } else {
      const idx = (nameIndexes.get(a.name) ?? 0) + 1
      nameIndexes.set(a.name, idx)
      result.set(a.id, idx === 1 ? a.name : `${a.name} #${idx}`)
    }
  }

  return result
}

function ContextMenu({
  agent,
  onEdit,
  onDelete,
  onClose,
}: {
  agent: Agent
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-6 z-10 w-32 bg-white border border-gray-200 py-1"
      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
    >
      <button
        onClick={() => { onEdit(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Edit
      </button>
      <button
        onClick={() => { onDelete(); onClose() }}
        className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
      >
        Delete
      </button>
    </div>
  )
}

export default function AgentList({ agents, isDemo, onSelect, onToggle, onDelete }: AgentListProps) {
  const [toggling, setToggling] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const handleToggle = async (agent: Agent) => {
    if (isDemo || toggling) return
    setToggling(agent.skill_type)
    try {
      await fetch('/api/agents/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillType: agent.skill_type, isActive: !agent.is_active }),
      })
      onToggle?.(agent.skill_type, !agent.is_active)
    } catch {
      // Silent fail — UI will refresh on next fetch
    }
    setToggling(null)
  }

  const handleDelete = async (agent: Agent) => {
    if (isDemo) return
    if (!confirm(`Delete "${agent.name}"? This cannot be undone.`)) return
    try {
      await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
      onDelete?.(agent.id)
    } catch {
      // Silent fail
    }
  }

  const displayNames = numberAgentNames(agents)

  if (agents.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-xs text-gray-400">No agents configured yet.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {agents.map(agent => {
        const active = toggling === agent.skill_type ? !agent.is_active : agent.is_active

        return (
          <div key={agent.id} className="px-5 py-3 flex items-center gap-3">
            {/* Toggle */}
            <button
              onClick={() => handleToggle(agent)}
              disabled={isDemo || toggling === agent.skill_type}
              className="flex-shrink-0 relative w-9 h-5 transition-colors"
              style={{
                backgroundColor: active ? '#0063FF' : '#D1D5DB',
              }}
              aria-label={`Toggle ${agent.name}`}
            >
              <span
                className="absolute top-0.5 w-4 h-4 bg-white transition-transform"
                style={{
                  left: active ? 18 : 2,
                }}
              />
            </button>

            {/* Content — single row with inline metadata */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {displayNames.get(agent.id) ?? agent.name}
                </span>
                <span
                  className="flex-shrink-0 text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5"
                  style={{
                    backgroundColor: active ? 'rgba(0, 99, 255, 0.08)' : '#F3F4F6',
                    color: active ? '#0063FF' : '#9CA3AF',
                  }}
                >
                  {triggerLabel(agent)}
                </span>
                {agent.created_at && (
                  <span className="flex-shrink-0 text-[10px] text-gray-400">
                    {shortDate(agent.created_at)}
                  </span>
                )}
              </div>
              {agent.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {agent.description}
                </p>
              )}
            </div>

            {/* Stats */}
            <div className="flex-shrink-0 flex items-center gap-3">
              {agent.last_run_at ? (
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {timeAgo(agent.last_run_at)} · {agent.run_count ?? 0} runs
                </span>
              ) : (
                <span className="text-[10px] text-gray-400">No runs</span>
              )}

              {/* Context menu trigger */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(menuOpen === agent.id ? null : agent.id)}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Agent options"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="3" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="8" cy="13" r="1.5" />
                  </svg>
                </button>
                {menuOpen === agent.id && (
                  <ContextMenu
                    agent={agent}
                    onEdit={() => onSelect?.(agent)}
                    onDelete={() => handleDelete(agent)}
                    onClose={() => setMenuOpen(null)}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
