'use client'

import { useState } from 'react'

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
}

interface AgentListProps {
  agents: Agent[]
  isDemo?: boolean
  onToggle?: (skillType: string, isActive: boolean) => void
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

function triggerLabel(agent: Agent): string {
  if (agent.trigger_mode === 'event') {
    return 'On event'
  }
  if (agent.cron_schedule === 'daily') return 'Daily'
  if (agent.cron_schedule === 'weekly') return 'Weekly'
  if (agent.cron_schedule === 'hourly') return 'Hourly'
  return agent.cron_schedule || 'Scheduled'
}

export default function AgentList({ agents, isDemo, onToggle }: AgentListProps) {
  const [toggling, setToggling] = useState<string | null>(null)

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
          <div key={agent.id} className="px-5 py-4 flex items-start gap-4">
            {/* Toggle */}
            <button
              onClick={() => handleToggle(agent)}
              disabled={isDemo || toggling === agent.skill_type}
              className="mt-0.5 flex-shrink-0 relative w-9 h-5 transition-colors"
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

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {agent.name}
                </span>
                <span
                  className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5"
                  style={{
                    backgroundColor: active ? 'rgba(0, 99, 255, 0.08)' : '#F3F4F6',
                    color: active ? '#0063FF' : '#9CA3AF',
                  }}
                >
                  {triggerLabel(agent)}
                </span>
              </div>
              {agent.description && (
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {agent.description}
                </p>
              )}
              {agent.system_prompt && (
                <p className="text-xs text-gray-400 mt-1 italic truncate">
                  Custom: &quot;{agent.system_prompt}&quot;
                </p>
              )}
            </div>

            {/* Stats */}
            <div className="flex-shrink-0 text-right">
              {agent.last_run_at ? (
                <>
                  <p className="text-xs text-gray-500">{timeAgo(agent.last_run_at)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {agent.run_count ?? 0} runs
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-400">—</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
