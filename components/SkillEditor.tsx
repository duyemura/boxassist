'use client'

import { useState, useEffect } from 'react'

interface Skill {
  id: string
  slug: string
  name: string
  description: string
  category: string
  trigger_condition: string
  is_system: boolean
  is_active: boolean
  default_value_usd: number
  gym_id?: string | null
  system_prompt?: string
  tone_guidance?: string
  escalation_rules?: string
  success_criteria?: string
  followup_cadence?: string
  automation_level?: string
}

interface SkillEditorProps {
  skill: Skill
  isDemo: boolean
  onBack: () => void
  onSaved: () => void
  onDeleted: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  retention: 'Retention',
  growth: 'Growth',
  billing: 'Billing',
}

const CATEGORY_OPTIONS = ['retention', 'growth', 'billing']

const AUTOMATION_OPTIONS = [
  {
    value: 'draft_only',
    label: 'Draft only',
    sublabel: 'Human approves every message',
  },
  {
    value: 'smart',
    label: 'Smart',
    sublabel: 'Auto-send low-risk, queue high-risk',
  },
  {
    value: 'full_auto',
    label: 'Full auto',
    sublabel: 'Agent sends without approval',
  },
]

export default function SkillEditor({ skill, isDemo, onBack, onSaved, onDeleted }: SkillEditorProps) {
  const isSystemSkill = skill.is_system && !skill.gym_id
  const isEditable = !isSystemSkill || isDemo === false

  // Local editing state — clone fields
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const [category, setCategory] = useState(skill.category)
  const [trigger, setTrigger] = useState(skill.trigger_condition ?? '')
  const [systemPrompt, setSystemPrompt] = useState(skill.system_prompt ?? '')
  const [tone, setTone] = useState(skill.tone_guidance ?? '')
  const [escalation, setEscalation] = useState(skill.escalation_rules ?? '')
  const [successCriteria, setSuccessCriteria] = useState(skill.success_criteria ?? '')
  const [automationLevel, setAutomationLevel] = useState<'draft_only' | 'smart' | 'full_auto'>((skill.automation_level as any) ?? 'draft_only')
  const [valueUsd, setValueUsd] = useState(String(skill.default_value_usd ?? 0))

  const [saving, setSaving] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // AI skill generator — auto-open for new/empty skills
  const isNewSkill = !skill.system_prompt && !skill.trigger_condition && !skill.is_system
  const [genOpen, setGenOpen] = useState(isNewSkill)
  const [genIntent, setGenIntent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // Reset when skill changes
  useEffect(() => {
    setName(skill.name)
    setDescription(skill.description)
    setCategory(skill.category)
    setTrigger(skill.trigger_condition ?? '')
    setSystemPrompt(skill.system_prompt ?? '')
    setTone(skill.tone_guidance ?? '')
    setEscalation(skill.escalation_rules ?? '')
    setSuccessCriteria(skill.success_criteria ?? '')
    setAutomationLevel((skill.automation_level as any) ?? 'draft_only')
    setValueUsd(String(skill.default_value_usd ?? 0))
    setSaved(false)
    setError(null)
  }, [skill.id])

  const handleGenerate = async () => {
    if (!genIntent.trim()) return
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/api/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: genIntent,
          currentFields: { name, description },
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Generation failed')
      const s = data.skill
      if (s.name) setName(s.name)
      if (s.description) setDescription(s.description)
      if (s.category && ['retention', 'growth', 'billing'].includes(s.category)) setCategory(s.category)
      if (s.trigger_condition) setTrigger(s.trigger_condition)
      if (s.system_prompt) setSystemPrompt(s.system_prompt)
      if (s.tone_guidance) setTone(s.tone_guidance)
      if (s.escalation_rules) setEscalation(s.escalation_rules)
      if (s.success_criteria) setSuccessCriteria(s.success_criteria)
      if (s.default_value_usd) setValueUsd(String(s.default_value_usd))
      setGenOpen(false)
      setGenIntent('')
    } catch (err: any) {
      setGenError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (isDemo) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/skills/${skill.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, description, category,
          trigger_condition: trigger,
          system_prompt: systemPrompt,
          tone_guidance: tone,
          escalation_rules: escalation,
          success_criteria: successCriteria,
          automation_level: automationLevel,
          default_value_usd: parseFloat(valueUsd) || 0,
        }),
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

  const handleClone = async () => {
    if (isDemo) return
    setCloning(true)
    try {
      await fetch(`/api/skills/${skill.id}/clone`, { method: 'POST' })
      onSaved()
      onBack()
    } catch (err: any) {
      setError('Clone failed')
    } finally {
      setCloning(false)
    }
  }

  const handleDelete = async () => {
    if (isDemo) return
    if (!confirm(`Delete "${skill.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await fetch(`/api/skills/${skill.id}`, { method: 'DELETE' })
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
          ← Playbooks
        </button>
        <div className="flex items-center gap-3">
          {isSystemSkill && (
            <span className="text-[10px] text-gray-300 border border-gray-100 px-2 py-0.5">system · read-only</span>
          )}
          {isSystemSkill && !isDemo && (
            <button
              onClick={handleClone}
              disabled={cloning}
              className="text-xs font-semibold px-3 py-1.5 border transition-colors disabled:opacity-50"
              style={{ borderColor: '#0063FF', color: '#0063FF' }}
            >
              {cloning ? 'Cloning…' : 'Clone & customize'}
            </button>
          )}
          {!isSystemSkill && !isDemo && (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-xs font-semibold text-white px-4 py-1.5 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#0063FF' }}
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-3 py-2 border-l-2 border-red-400 bg-red-50">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* AI generator panel — editable skills only */}
      {!isSystemSkill && !isDemo && (
        <div className="border-b border-gray-100">
          {!genOpen ? (
            <button
              onClick={() => setGenOpen(true)}
              className="flex items-center gap-1.5 px-6 py-3 text-xs font-medium transition-colors w-full text-left hover:bg-gray-50"
              style={{ color: '#9CA3AF' }}
            >
              <span>✨</span>
              <span>Describe what you want and AI will fill in the fields</span>
            </button>
          ) : (
            <div className="px-6 py-4 space-y-3 bg-blue-50/40">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-600">✨ AI playbook builder</p>
                <button onClick={() => { setGenOpen(false); setGenError(null) }} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
              <textarea
                value={genIntent}
                onChange={e => setGenIntent(e.target.value)}
                placeholder="Describe the playbook in plain English… e.g. 'Reach out to members who haven't shown up in 3 weeks but are still paying — friendly check-in, no pressure, offer a free session with a coach'"
                rows={3}
                className="w-full text-sm border border-blue-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 resize-none transition-colors"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
                autoFocus
              />
              {genError && <p className="text-xs text-red-500">{genError}</p>}
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-gray-400">⌘↵ to generate · All fields will be filled in for you</p>
                <button
                  onClick={handleGenerate}
                  disabled={!genIntent.trim() || generating}
                  className="text-xs font-semibold text-white px-4 py-1.5 transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: '#0063FF' }}
                >
                  {generating ? 'Generating…' : 'Generate ✨'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form */}
      <div className="flex-1 px-6 py-6 space-y-6 max-w-2xl">

        {/* Name + Category row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isSystemSkill}
              className={fieldCls}
              placeholder="Playbook name"
            />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              disabled={isSystemSkill}
              className={fieldCls + ' bg-white'}
            >
              {CATEGORY_OPTIONS.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={isSystemSkill}
            rows={2}
            className={fieldCls + ' resize-none'}
            placeholder="What does this playbook do?"
          />
        </div>

        {/* Trigger */}
        <div>
          <label className={labelCls}>Trigger condition</label>
          <textarea
            value={trigger}
            onChange={e => setTrigger(e.target.value)}
            disabled={isSystemSkill}
            rows={3}
            className={fieldCls + ' resize-none text-xs'}
            placeholder="Describe in plain English when this playbook should fire…"
          />
          <p className="text-[10px] text-gray-400 mt-1">When should this playbook fire? Write in plain English.</p>
        </div>

        {/* Agent instructions */}
        <div>
          <label className={labelCls}>Agent instructions</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            disabled={isSystemSkill}
            rows={5}
            className={fieldCls + ' resize-y font-mono text-xs leading-relaxed'}
            placeholder="Instructions for the agent — what to do, what to say, what to avoid…"
          />
        </div>

        {/* Tone */}
        <div>
          <label className={labelCls}>Tone guidance</label>
          <textarea
            value={tone}
            onChange={e => setTone(e.target.value)}
            disabled={isSystemSkill}
            rows={2}
            className={fieldCls + ' resize-none text-xs'}
            placeholder="e.g. Warm, personal, never pushy. First name only. Short sentences."
          />
        </div>

        {/* Two col: escalation + success */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Escalation rules</label>
            <textarea
              value={escalation}
              onChange={e => setEscalation(e.target.value)}
              disabled={isSystemSkill}
              rows={3}
              className={fieldCls + ' resize-none text-xs'}
              placeholder="When to escalate to owner…"
            />
          </div>
          <div>
            <label className={labelCls}>Success criteria</label>
            <textarea
              value={successCriteria}
              onChange={e => setSuccessCriteria(e.target.value)}
              disabled={isSystemSkill}
              rows={3}
              className={fieldCls + ' resize-none text-xs'}
              placeholder="How do we know it worked?"
            />
          </div>
        </div>

        {/* Automation level */}
        <div>
          <label className={labelCls}>Automation level</label>
          <div className="flex gap-0 border border-gray-200 w-full overflow-hidden">
            {AUTOMATION_OPTIONS.map((opt, idx) => {
              const isSelected = automationLevel === opt.value
              const isClickable = !isSystemSkill && !isDemo
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!isClickable}
                  onClick={() => isClickable && setAutomationLevel(opt.value as 'draft_only' | 'smart' | 'full_auto')}
                  className={[
                    'flex-1 px-3 py-2.5 text-left transition-colors',
                    idx < AUTOMATION_OPTIONS.length - 1 ? 'border-r border-gray-200' : '',
                    isClickable ? 'cursor-pointer' : 'cursor-default',
                    isSelected
                      ? 'bg-blue-50'
                      : isClickable
                        ? 'bg-white hover:bg-gray-50'
                        : 'bg-white',
                  ].join(' ')}
                  style={isSelected ? { backgroundColor: '#EEF5FF' } : {}}
                >
                  <p
                    className="text-xs font-semibold"
                    style={isSelected ? { color: '#0063FF' } : { color: '#374151' }}
                  >
                    {opt.label}
                  </p>
                  <p
                    className="text-[10px] mt-0.5 leading-tight"
                    style={isSelected ? { color: '#3B82F6' } : { color: '#9CA3AF' }}
                  >
                    {opt.sublabel}
                  </p>
                </button>
              )
            })}
          </div>
          {isSystemSkill && (
            <p className="text-[10px] text-gray-400 mt-1">Clone this playbook to change the automation level.</p>
          )}
        </div>

        {/* Est. value */}
        <div className="max-w-xs">
          <label className={labelCls}>Est. value per member saved ($)</label>
          <input
            type="number"
            value={valueUsd}
            onChange={e => setValueUsd(e.target.value)}
            disabled={isSystemSkill}
            className={fieldCls}
            placeholder="130"
            min="0"
          />
          <p className="text-[10px] text-gray-400 mt-1">Used to calculate ROI when this playbook saves a member.</p>
        </div>

        {/* System skill CTA */}
        {isSystemSkill && !isDemo && (
          <div className="pt-2 pb-8">
            <p className="text-xs text-gray-400 mb-3">This is a system playbook — read-only. Clone it to create a customized version for your gym.</p>
            <button
              onClick={handleClone}
              disabled={cloning}
              className="text-xs font-semibold px-4 py-2 text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#0063FF' }}
            >
              {cloning ? 'Cloning…' : 'Clone & customize →'}
            </button>
          </div>
        )}

        {/* Demo notice */}
        {isDemo && (
          <div className="pt-2 pb-8">
            <p className="text-xs text-gray-400">Connect your gym to edit and customize playbooks.</p>
          </div>
        )}
      </div>
    </div>
  )
}
