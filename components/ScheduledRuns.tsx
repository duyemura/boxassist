'use client'

interface AgentSchedule {
  id: string
  name: string
  is_active: boolean
  trigger_mode: string
  cron_schedule?: string
  run_hour?: number
  trigger_event?: string
  next_run_at?: string | null
}

function formatNextIn(nextRunAt: string | null | undefined): string {
  if (!nextRunAt) return ''
  const diff = new Date(nextRunAt).getTime() - Date.now()
  if (diff <= 0) return 'soon'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function scheduleDesc(agent: AgentSchedule): string {
  if (agent.trigger_mode === 'event') {
    const evt = agent.trigger_event ?? 'event'
    return 'On ' + evt.replace(/\./g, ' › ').replace(/_/g, ' ')
  }
  if (agent.trigger_mode === 'manual') return 'Manual'
  const hour = agent.run_hour ?? 9
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const map: Record<string, string> = {
    daily: `Daily · ${h}${ampm}`,
    weekly: `Weekly · ${h}${ampm}`,
    hourly: 'Hourly',
  }
  return map[agent.cron_schedule ?? 'daily'] ?? `Scheduled · ${h}${ampm}`
}

export default function ScheduledRuns({ agents }: { agents: AgentSchedule[] }) {
  if (agents.length === 0) return null

  return (
    <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-gray-100">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">
        Scheduled Runs
      </p>
      <div className="space-y-2.5">
        {agents.map(agent => {
          const nextIn = agent.trigger_mode === 'cron' && agent.is_active
            ? formatNextIn(agent.next_run_at)
            : null
          return (
            <div key={agent.id} className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 flex-shrink-0"
                style={{ backgroundColor: agent.is_active ? '#16A34A' : '#D1D5DB' }}
              />
              <span className="text-xs text-gray-700 font-medium truncate flex-1 min-w-0">
                {agent.name}
              </span>
              <span className="text-[10px] text-gray-400 flex-shrink-0">
                {scheduleDesc(agent)}
              </span>
              {nextIn && (
                <span
                  className="text-[10px] font-semibold flex-shrink-0 tabular-nums"
                  style={{ color: '#0063FF' }}
                >
                  {nextIn}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
