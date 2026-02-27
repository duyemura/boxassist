'use client'

import { useEffect, useState, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SkillCustomization {
  id: string
  skill_id: string
  notes: string
  updated_at: string
}

interface Skill {
  id: string
  filename: string
  domain: string
  applies_when: string
  triggers: string[]
  body: string
  customization: SkillCustomization | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  retention:  '#0063FF',
  analysis:   '#7C3AED',
  sales:      '#059669',
  general:    '#6B7280',
}

function domainColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? DOMAIN_COLORS.general
}

function formatSkillName(id: string): string {
  return id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Skill Card ────────────────────────────────────────────────────────────────

function SkillCard({ skill, onSave, onDelete }: {
  skill: Skill
  onSave: (skillId: string, notes: string) => Promise<boolean>
  onDelete: (skillId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState(skill.customization?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Strip markdown headers/symbols for a readable preview
  const bodyPreview = skill.body
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/^#{1,3} .+$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const color = domainColor(skill.domain)
  const hasCustomization = !!skill.customization

  const handleEditStart = () => {
    setNotes(skill.customization?.notes ?? '')
    setSaveError(false)
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleCancel = () => {
    setEditing(false)
    setSaveError(false)
  }

  const handleSave = async () => {
    if (!notes.trim() || saving) return
    setSaving(true)
    setSaveError(false)
    const ok = await onSave(skill.id, notes.trim())
    setSaving(false)
    if (ok) {
      setEditing(false)
    } else {
      setSaveError(true)
    }
  }

  const handleDelete = async () => {
    await onDelete(skill.id)
    setConfirming(false)
    setNotes('')
  }

  return (
    <div
      className="border border-gray-100 bg-white"
      style={{ borderLeft: `2px solid ${color}` }}
    >
      {/* Header row */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{formatSkillName(skill.id)}</span>
            <span
              className="text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5 flex-shrink-0"
              style={{ backgroundColor: `${color}15`, color }}
            >
              {skill.domain}
            </span>
            {hasCustomization && !editing && (
              <span className="text-[10px] font-semibold tracking-widests uppercase px-1.5 py-0.5 flex-shrink-0" style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}>
                customized
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{skill.applies_when}</p>
        </div>

        {/* Actions */}
        {!editing && (
          <div className="flex-shrink-0 flex items-center gap-1">
            <button
              onClick={handleEditStart}
              className="text-[10px] text-gray-400 hover:text-gray-700 px-1.5 py-0.5 transition-colors"
            >
              Edit
            </button>
            {hasCustomization && (
              confirming ? (
                <button
                  onClick={handleDelete}
                  className="text-[10px] px-1.5 py-0.5 transition-colors"
                  style={{ color: '#EF4444' }}
                >
                  Confirm
                </button>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  onBlur={() => setTimeout(() => setConfirming(false), 150)}
                  className="text-[10px] text-gray-400 hover:text-red-500 px-1.5 py-0.5 transition-colors"
                >
                  Remove
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Skill body preview */}
      {!editing && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
          >
            <span>{expanded ? '▾' : '▸'}</span> Playbook
          </button>
          {expanded && (
            <p className="text-xs text-gray-500 leading-relaxed mt-1.5 whitespace-pre-line">
              {bodyPreview}
            </p>
          )}
        </div>
      )}

      {/* Existing note (view mode) */}
      {hasCustomization && !editing && (
        <div className="px-4 pb-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1">Your instructions</p>
          <p className="text-xs text-gray-700 leading-relaxed border-l-2 border-gray-200 pl-2.5">
            {skill.customization!.notes}
          </p>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="px-4 pb-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1.5">Your instructions</p>
          <textarea
            ref={textareaRef}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={`Add business-specific notes — e.g. "Always mention our Saturday intro class. Sign off as Coach Mike."`}
            rows={3}
            className="w-full text-sm text-gray-800 border border-gray-200 px-3 py-2 resize-none focus:outline-none focus:border-blue-400 mb-2"
          />
          <div className="flex items-center gap-2 justify-end">
            {saveError && <span className="text-[10px] text-red-500 mr-auto">Failed to save</span>}
            <button
              onClick={handleCancel}
              className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!notes.trim() || saving}
              className="text-[10px] font-semibold text-white px-3 py-1 transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: '#0063FF' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSkills = () => {
    fetch('/api/skills')
      .then(r => r.json())
      .then(json => { setSkills(json.skills ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load skills'); setLoading(false) })
  }

  useEffect(() => { fetchSkills() }, [])

  const handleSave = async (skillId: string, notes: string): Promise<boolean> => {
    const res = await fetch('/api/skills', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, notes }),
    })
    if (res.ok) {
      const json = await res.json()
      setSkills(prev => prev.map(s =>
        s.id === skillId ? { ...s, customization: json.customization } : s
      ))
      return true
    }
    return false
  }

  const handleDelete = async (skillId: string): Promise<void> => {
    await fetch('/api/skills', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId }),
    })
    setSkills(prev => prev.map(s => s.id === skillId ? { ...s, customization: null } : s))
  }

  const customized = skills.filter(s => s.customization)
  const uncustomized = skills.filter(s => !s.customization)

  return (
    <div className="overflow-y-auto flex-1">
      <div className="px-6 pt-5 pb-4 border-b border-gray-100">
        <h1 className="text-lg font-semibold text-gray-900">Skills</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Playbooks that guide how agents handle each situation. Add notes to steer a skill for your business.
        </p>
      </div>

      <div className="px-6 py-6">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-3 h-3 border border-gray-300 border-t-blue-500 animate-spin" style={{ borderRadius: '50%' }} />
            Loading skills…
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            {/* Customized skills first */}
            {customized.length > 0 && (
              <div className="mb-6">
                <div className="flex items-baseline gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-gray-900">Customized</h2>
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
                    {customized.length} {customized.length === 1 ? 'skill' : 'skills'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {customized.map(s => (
                    <SkillCard key={s.id} skill={s} onSave={handleSave} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}

            {/* All other skills */}
            <div>
              <div className="flex items-baseline gap-3 mb-1">
                <h2 className="text-sm font-semibold text-gray-900">All Skills</h2>
                <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
                  {uncustomized.length} using defaults
                </span>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                These skills run as-is. Add a note to any skill to customize it for your business.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {uncustomized.map(s => (
                  <SkillCard key={s.id} skill={s} onSave={handleSave} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
