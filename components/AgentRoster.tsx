'use client'

import { useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentWithStats {
  id: string
  name: string
  description?: string
  skill_type: string
  is_active: boolean
  is_system?: boolean
  trigger_mode: string
  cron_schedule?: string
  run_hour?: number
  trigger_event?: string
  last_run_at?: string
  run_count?: number
  pending_count?: number
  next_run_at?: string | null
  created_at?: string
}

interface AgentRosterProps {
  agents: AgentWithStats[]
  isDemo?: boolean
  onSelect?: (agent: AgentWithStats) => void
  onToggle?: (skillType: string, isActive: boolean) => void
  onDelete?: (agentId: string) => void
  onAddAgent?: () => void
  onChat?: (agent: AgentWithStats) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function triggerLabel(agent: AgentWithStats): string {
  if (agent.trigger_mode === 'event') return 'On event'
  if (agent.trigger_mode === 'manual') return 'Manual'
  const map: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', hourly: 'Hourly' }
  return map[agent.cron_schedule ?? 'daily'] ?? 'Scheduled'
}

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({ agent, isDemo, onSelect, onToggle, onDelete, onChat }: {
  agent: AgentWithStats
  isDemo?: boolean
  onSelect?: (a: AgentWithStats) => void
  onToggle?: (skillType: string, isActive: boolean) => void
  onDelete?: (id: string) => void
  onChat?: (a: AgentWithStats) => void
}) {
  const [toggling, setToggling] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const active = toggling ? !agent.is_active : agent.is_active
  const pending = agent.pending_count ?? 0

  const handleToggle = async () => {
    if (isDemo || toggling) return
    setToggling(true)
    try {
      await fetch('/api/agents/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillType: agent.skill_type, isActive: !agent.is_active }),
      })
      onToggle?.(agent.skill_type, !agent.is_active)
    } catch {
      // silent
    }
    setToggling(false)
  }

  const handleDelete = async () => {
    if (isDemo) return
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
      if (!res.ok) return
      onDelete?.(agent.id)
    } catch {
      // network error — don't update client state
    }
  }

  return (
    <div className="px-5 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition-colors group border-b border-gray-100 last:border-0">
      {/* Toggle */}
      <button
        onClick={handleToggle}
        disabled={isDemo || toggling}
        className="flex-shrink-0 relative w-8 h-4 mt-1.5 transition-colors"
        style={{ backgroundColor: active ? '#0063FF' : '#D1D5DB' }}
        aria-label={`Toggle ${agent.name}`}
      >
        <span
          className="absolute top-0.5 w-3 h-3 bg-white transition-all"
          style={{ left: active ? 14 : 2 }}
        />
      </button>

      {/* Status dot */}
      <div
        className="w-2 h-2 flex-shrink-0 mt-2"
        style={{ backgroundColor: !active ? '#D1D5DB' : agent.last_run_at ? '#16A34A' : '#0063FF' }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{agent.name}</span>
          <span
            className="text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 flex-shrink-0"
            style={{
              backgroundColor: active ? 'rgba(0,99,255,0.08)' : '#F3F4F6',
              color: active ? '#0063FF' : '#9CA3AF',
            }}
          >
            {triggerLabel(agent)}
          </span>
          {pending > 0 && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 flex-shrink-0"
              style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#D97706' }}
            >
              {pending} pending
            </span>
          )}
        </div>
        {agent.description && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{agent.description}</p>
        )}
        <p className="text-[10px] text-gray-400 mt-1">
          {agent.last_run_at
            ? `Last run ${timeAgo(agent.last_run_at)} · ${agent.run_count ?? 0} runs`
            : 'Never run'}
        </p>
      </div>

      {/* Actions */}
      {!isDemo && (
        <div className="flex-shrink-0 flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {active && (
            <button
              onClick={() => onChat?.(agent)}
              className="text-[10px] font-semibold px-1.5 py-0.5 transition-colors"
              style={{ color: '#0063FF' }}
            >
              Chat
            </button>
          )}
          <button
            onClick={() => onSelect?.(agent)}
            className="text-[10px] text-gray-400 hover:text-gray-700 px-1.5 py-0.5 transition-colors"
          >
            Edit
          </button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              onBlur={() => setTimeout(() => setConfirming(false), 150)}
              className="text-[10px] text-gray-400 hover:text-red-500 px-1.5 py-0.5 transition-colors"
            >
              Delete
            </button>
          ) : (
            <button
              onClick={() => { handleDelete(); setConfirming(false) }}
              className="text-[10px] px-1.5 py-0.5 transition-colors"
              style={{ color: '#EF4444' }}
            >
              Confirm
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AgentRoster({ agents, isDemo, onSelect, onToggle, onDelete, onAddAgent, onChat }: AgentRosterProps) {
  const gm = agents.find(a => a.skill_type === 'gm')
  const workflowAgents = agents.filter(a => a.skill_type !== 'gm')
  const activeCount = workflowAgents.filter(a => a.is_active).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-shrink-0 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Agent Roster</p>
          <span
            className="text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5"
            style={{ backgroundColor: 'rgba(0,99,255,0.08)', color: '#0063FF' }}
          >
            {activeCount} active
          </span>
        </div>
        {!isDemo && onAddAgent && (
          <button
            onClick={onAddAgent}
            className="text-xs font-medium text-white px-2.5 py-1 transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#0063FF' }}
          >
            + New
          </button>
        )}
      </div>

      <div className="overflow-y-auto flex-1">
        {/* GM — pinned at top */}
        {gm && (
          <div className="border-b border-gray-100">
            <div
              className="group flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => onChat?.(gm)}
            >
              <div
                className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white"
                style={{ backgroundColor: '#0063FF' }}
              >
                G
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">GM</span>
                  <span
                    className="text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5"
                    style={{ backgroundColor: 'rgba(0,99,255,0.08)', color: '#0063FF' }}
                  >
                    Always on
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">{gm.description ?? 'Your always-on business assistant'}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onChat?.(gm) }}
                className="flex-shrink-0 text-[10px] font-semibold px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: 'rgba(0,99,255,0.08)', color: '#0063FF' }}
              >
                Chat →
              </button>
            </div>
          </div>
        )}

        {/* Workflow agents */}
        {workflowAgents.map(agent => (
          <AgentRow
            key={agent.id}
            agent={agent}
            isDemo={isDemo}
            onSelect={onSelect}
            onToggle={onToggle}
            onDelete={onDelete}
            onChat={onChat}
          />
        ))}
      </div>
    </div>
  )
}
