'use client'

import Link from 'next/link'

interface Agent {
  id: string
  name: string
  active?: boolean
  skill_type?: string
  last_run_at?: string | null
}

interface AgentTableProps {
  agents: Agent[]
  selectedId: string | null
  onSelect: (id: string) => void
  isDemo?: boolean
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

function formatSkillType(skill: string | undefined): string {
  if (!skill) return '—'
  const map: Record<string, string> = {
    at_risk_detector: 'Churn guard',
    lead_catcher: 'Lead catcher',
    renewal_guard: 'Renewal',
    member_pulse: 'Member pulse',
    win_back: 'Win-back',
  }
  return map[skill] ?? skill.replace(/_/g, ' ')
}

export default function AgentTable({ agents, selectedId, onSelect, isDemo }: AgentTableProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-100 sticky top-0 bg-white z-10">
        <span className="w-1.5 h-1.5 flex-shrink-0" />
        <span className="text-xs text-gray-400 flex-1">Agent</span>
        <span className="text-xs text-gray-400 w-28 hidden sm:block">Type</span>
        <span className="text-xs text-gray-400 w-20 text-right hidden sm:block">Last run</span>
      </div>

      {agents.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 px-4">
          <p className="text-sm text-gray-500 mb-3">No agents yet.</p>
          <Link
            href="/agent-builder"
            className="text-xs font-semibold text-white px-4 py-2 transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#0063FF' }}
          >
            + Create your first agent
          </Link>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`flex items-center gap-4 px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                selectedId === agent.id ? 'bg-gray-50' : 'hover:bg-gray-50'
              }`}
              onClick={() => onSelect(agent.id)}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  agent.active ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
              <span className="text-sm font-medium text-gray-900 flex-1 truncate">{agent.name}</span>
              <span className="text-xs text-gray-400 w-28 hidden sm:block truncate">
                {formatSkillType(agent.skill_type)}
              </span>
              <span className="text-xs text-gray-300 w-20 text-right hidden sm:block">
                {agent.last_run_at ? timeAgo(agent.last_run_at) : 'never'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
