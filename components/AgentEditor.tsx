'use client'

import { useState, useEffect } from 'react'

interface Agent {
  id: string
  name: string
  description?: string
  active?: boolean
  skill_type?: string
  trigger_mode?: string
  cron_schedule?: string
  system_prompt?: string
  action_type?: string
  last_run_at?: string | null
  run_count?: number
}

interface AgentEditorProps {
  agent: Agent | null   // null = create new
  isDemo: boolean
  onBack: () => void
  onSaved: () => void
  onDeleted: () => void
}

const SCHEDULE_OPTIONS = [
  { value: 'daily', label: 'Daily (1am)' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'event', label: 'On event (real-time)' },
  { value: 'weekly', label: 'Weekly (Monday 9am)' },
]

export default function AgentEditor({ agent, isDemo, onBack, onSaved, onDeleted }: AgentEditorProps) {
  const isNew = !agent

  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [schedule, setSchedule] = useState(agent?.cron_schedule ?? 'daily')
  const [active, setActive] = useState(agent?.active ?? true)
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? '')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    setName(agent.name ?? '')
    setDescription(agent.description ?? '')
    setSchedule(agent.cron_schedule ?? 'daily')
    setActive(agent.active ?? true)
    setSystemPrompt(agent.system_prompt ?? '')
    setSaved(false)
    setError(null)
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
        // skill_type for new agents: derived from name as a freeform slug
        // the AI matches it semantically — no hardcoded enum needed
        ...(isNew ? { skill_type: name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') } : {}),
        cron_schedule: schedule,
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

        {/* Name */}
        <div>
          <label className={labelCls}>Agent name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className={fieldCls}
            placeholder="e.g. At-Risk Monitor"
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className={fieldCls + ' resize-none'}
            placeholder="What does this agent do?"
          />
        </div>

        {/* Schedule */}
        <div>
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

        {/* Custom instructions */}
        <div>
          <label className={labelCls}>
            Instructions
            <span className="text-gray-300 normal-case font-normal ml-1">(tells the AI what to do and how to communicate)</span>
          </label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={5}
            className={fieldCls + ' resize-y font-mono text-xs leading-relaxed'}
            placeholder="Describe what this agent should do, who to contact, and how to communicate. The AI figures out the rest."
          />
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
