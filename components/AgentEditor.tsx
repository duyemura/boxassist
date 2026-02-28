'use client'

import { useState, useEffect } from 'react'
import AgentPromptBuilder from './AgentPromptBuilder'

interface Agent {
  id: string
  name: string
  description?: string
  active?: boolean
  skill_type?: string
  trigger_mode?: string
  cron_schedule?: string
  run_hour?: number
  system_prompt?: string
  action_type?: string
  last_run_at?: string | null
  run_count?: number
}

interface AgentEditorProps {
  agent: Agent | null   // null = create new
  isDemo: boolean
  accountName?: string
  onBack: () => void
  onSaved: () => void
  onDeleted: () => void
}

const SCHEDULE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly (Monday)' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'event', label: 'On event (real-time)' },
]

// 12-hour display for hours 0–23
function hourLabel(h: number): string {
  if (h === 0) return '12:00 AM'
  if (h === 12) return '12:00 PM'
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: hourLabel(i) }))

export default function AgentEditor({ agent, isDemo, accountName: propAccountName, onBack, onSaved, onDeleted }: AgentEditorProps) {
  const isNew = !agent

  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [schedule, setSchedule] = useState(agent?.cron_schedule ?? 'daily')
  const [runHour, setRunHour] = useState(agent?.run_hour ?? 9)
  const [active, setActive] = useState(agent?.active ?? true)
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? '')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [autoGenerating, setAutoGenerating] = useState(false)

  useEffect(() => {
    if (!agent) return
    setName(agent.name ?? '')
    setDescription(agent.description ?? '')
    setSchedule(agent.cron_schedule ?? 'daily')
    setRunHour(agent.run_hour ?? 9)
    setActive(agent.active ?? true)
    setSystemPrompt(agent.system_prompt ?? '')
    setSaved(false)
    setError(null)

    // Auto-generate instructions for existing agents with blank prompts
    if (agent.id && !agent.system_prompt?.trim() && agent.name && agent.skill_type) {
      setAutoGenerating(true)
      fetch('/api/setup/generate-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentType: agent.skill_type,
          agentName: agent.name,
          accountName: propAccountName || '',
          description: agent.description || '',
        }),
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.instructions) setSystemPrompt(data.instructions)
        })
        .catch(() => {})
        .finally(() => setAutoGenerating(false))
    }
  }, [agent?.id])

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    // Demo mode — just show saved state locally, no API call
    if (isDemo) {
      await new Promise(r => setTimeout(r, 400))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setSaving(false)
      return
    }

    try {
      const payload = {
        name, description,
        ...(isNew ? { skill_type: name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') } : {}),
        cron_schedule: schedule,
        run_hour: runHour,
        active,
        system_prompt: systemPrompt,
      }
      const res = isNew
        ? await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/agents/${agent!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (isDemo || !agent) return
    if (!confirm(`Delete "${agent.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
      onDeleted()
      onBack()
    } catch {
      setError('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const fieldCls = "w-full text-sm border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 transition-colors"
  const labelCls = "text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1 block"
  const showTimePicker = schedule === 'daily' || schedule === 'weekly'

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1 transition-colors"
        >
          ← Agents
        </button>
        <div className="flex items-center gap-3">
          {!isNew && !isDemo && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="text-xs font-semibold text-white px-4 py-1.5 transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#0063FF' }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create agent' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-3 py-2 border-l-2 border-red-400 bg-red-50">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {isDemo && (
        <div className="mx-6 mt-4 px-3 py-2 border-l-2 bg-blue-50" style={{ borderColor: '#0063FF' }}>
          <p className="text-xs" style={{ color: '#0063FF' }}>Demo mode — changes won't be saved. <a href="/login" className="font-semibold underline">Connect your gym</a> to manage real agents.</p>
        </div>
      )}

      <div className="flex-1 px-6 py-6 space-y-6 max-w-2xl">

        {/* Name + description + AI prompt (shared builder) */}
        {autoGenerating && (
          <div className="flex items-center gap-2 px-3 py-2 border border-blue-100" style={{ backgroundColor: '#F0F6FF' }}>
            <span className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0063FF', borderTopColor: 'transparent' }} />
            <p className="text-xs" style={{ color: '#0063FF' }}>Generating personalized instructions…</p>
          </div>
        )}
        <AgentPromptBuilder
          name={name}
          description={description}
          systemPrompt={systemPrompt}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onSystemPromptChange={setSystemPrompt}
          disabled={isDemo}
        />

        {/* Schedule + time picker */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Schedule</label>
            <select
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className={fieldCls + ' bg-white'}
            >
              {SCHEDULE_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          {showTimePicker && (
            <div className="w-36">
              <label className={labelCls}>Run at (UTC)</label>
              <select
                value={runHour}
                onChange={e => setRunHour(Number(e.target.value))}
                className={fieldCls + ' bg-white'}
              >
                {HOUR_OPTIONS.map(h => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between py-3 border-t border-b border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-900">Active</p>
            <p className="text-xs text-gray-400 mt-0.5">Agent runs on schedule and monitors members</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => setActive(!active)}
            className="relative flex-shrink-0 transition-colors duration-200 focus:outline-none"
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              backgroundColor: active ? '#0063FF' : '#D1D5DB',
            }}
          >
            <span
              className="absolute bg-white shadow-sm transition-transform duration-200"
              style={{
                top: 2,
                left: 2,
                width: 20,
                height: 20,
                borderRadius: 10,
                transform: active ? 'translateX(20px)' : 'translateX(0)',
              }}
            />
          </button>
        </div>

        {/* Stats — edit mode only */}
        {!isNew && agent && (
          <div className="pt-2 pb-8 grid grid-cols-2 gap-4 border-t border-gray-100">
            <div>
              <p className={labelCls}>Total runs</p>
              <p className="text-sm font-semibold text-gray-900">{agent.run_count ?? 0}</p>
            </div>
            <div>
              <p className={labelCls}>Last run</p>
              <p className="text-sm font-semibold text-gray-900">
                {agent.last_run_at ? new Date(agent.last_run_at).toLocaleDateString() : 'Never'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
