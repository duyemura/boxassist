'use client'

import { useEffect, useState, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Memory {
  id: string
  category: string
  content: string
  importance: number
  scope: string
  source: 'owner' | 'agent' | 'system'
  member_id: string | null
  created_at: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  gym_context: {
    label: 'Business Context',
    color: '#0063FF',
    description: 'What the AI knows about your business — inferred at connect time and updated over time.',
  },
  business_stats: {
    label: 'Business Stats',
    color: '#0063FF',
    description: 'Key metrics synced from PushPress — member counts, revenue, and growth.',
  },
  schedule_and_attendance: {
    label: 'Schedule & Attendance',
    color: '#0891B2',
    description: 'Class schedule, programs, and attendance trends.',
  },
  preference: {
    label: 'Owner Preferences',
    color: '#7C3AED',
    description: 'Communication style, tone, and behaviour preferences the AI follows.',
  },
  member_fact: {
    label: 'Member Notes',
    color: '#059669',
    description: 'Facts about individual members picked up during conversations.',
  },
  learned_pattern: {
    label: 'Learned Patterns',
    color: '#D97706',
    description: 'Patterns the AI has observed over time — what works for your community.',
  },
}

const FALLBACK_CONFIG = { color: '#6B7280', description: 'Additional context the AI has stored.' }

function categoryConfig(category: string) {
  return CATEGORY_CONFIG[category] ?? {
    ...FALLBACK_CONFIG,
    label: category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }
}

const KNOWN_ORDER = ['gym_context', 'business_stats', 'schedule_and_attendance', 'preference', 'member_fact', 'learned_pattern']

const CATEGORY_OPTIONS = [
  { value: 'preference', label: 'Owner Preference' },
  { value: 'gym_context', label: 'Business Context' },
  { value: 'member_fact', label: 'Member Note' },
  { value: 'learned_pattern', label: 'Learned Pattern' },
]

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: 'AI', color: '#0063FF' },
  owner: { label: 'You', color: '#374151' },
  system: { label: 'System', color: '#6B7280' },
}

const IMPORTANCE_LABELS: Record<number, string> = {
  1: 'Background only',
  2: 'Low priority',
  3: 'Standard',
  4: 'High priority',
  5: 'Critical — always included',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImportanceDots({ value, interactive, onChange, showLabel }: {
  value: number
  interactive?: boolean
  onChange?: (v: number) => void
  showLabel?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <button
            key={i}
            type="button"
            disabled={!interactive}
            onClick={() => onChange?.(i)}
            className={interactive ? 'cursor-pointer hover:opacity-70' : 'cursor-default'}
            style={{ padding: 0, border: 'none', background: 'none' }}
          >
            <div
              className="w-1.5 h-1.5"
              style={{ backgroundColor: i <= value ? '#0063FF' : '#E5E7EB' }}
            />
          </button>
        ))}
      </div>
      {showLabel && (
        <span className="text-[10px] text-gray-400">{IMPORTANCE_LABELS[value]}</span>
      )}
    </div>
  )
}

function MemoryCard({ memory, onSave, onDelete }: {
  memory: Memory
  onSave: (id: string, updates: { content: string; category: string; importance: number }) => Promise<boolean>
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [content, setContent] = useState(memory.content)
  const [category, setCategory] = useState(memory.category)
  const [importance, setImportance] = useState(memory.importance)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const source = SOURCE_LABELS[memory.source] ?? SOURCE_LABELS.system
  const date = new Date(memory.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const accentColor = CATEGORY_CONFIG[memory.category]?.color ?? '#E5E7EB'

  const handleEditStart = () => {
    setContent(memory.content)
    setCategory(memory.category)
    setImportance(memory.importance)
    setSaveError(false)
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleCancel = () => {
    setEditing(false)
    setSaveError(false)
  }

  const handleSave = async () => {
    if (!content.trim() || saving) return
    setSaving(true)
    setSaveError(false)
    const ok = await onSave(memory.id, { content: content.trim(), category, importance })
    setSaving(false)
    if (ok) {
      setEditing(false)
    } else {
      setSaveError(true)
    }
  }

  if (editing) {
    return (
      <div
        className="px-4 py-3 border bg-white"
        style={{ borderColor: accentColor, borderLeft: `2px solid ${accentColor}` }}
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={3}
          className="w-full text-sm text-gray-800 border border-gray-200 px-3 py-2 resize-none focus:outline-none focus:border-blue-400 mb-3"
        />
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="text-xs text-gray-700 border border-gray-200 px-2 py-1 focus:outline-none focus:border-blue-400"
            >
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Importance</label>
            <ImportanceDots value={importance} interactive onChange={setImportance} showLabel />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {saveError && <span className="text-[10px] text-red-500">Failed to save</span>}
            <button
              onClick={handleCancel}
              className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!content.trim() || saving}
              className="text-[10px] font-semibold text-white px-3 py-1 transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: '#0063FF' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="group px-4 py-3 border border-gray-100 bg-white"
      style={{ borderLeft: `2px solid ${accentColor}` }}
    >
      <div className="flex items-start gap-2">
        <p className="text-sm text-gray-800 leading-relaxed flex-1 whitespace-pre-line">{memory.content}</p>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={handleEditStart}
            className="text-[10px] text-gray-400 hover:text-gray-700 px-1.5 py-0.5 transition-colors"
          >
            Edit
          </button>
          {confirming ? (
            <button
              onClick={() => { onDelete(memory.id); setConfirming(false) }}
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
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <ImportanceDots value={importance} />
        <span
          className="text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5"
          style={{ backgroundColor: `${source.color}15`, color: source.color }}
        >
          {source.label}
        </span>
        {memory.member_id && (
          <span className="text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5 bg-gray-100 text-gray-500">
            Member
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">{date}</span>
      </div>
    </div>
  )
}

function CategorySection({ category, memories, onSave, onDelete }: {
  category: string
  memories: Memory[]
  onSave: (id: string, updates: { content: string; category: string; importance: number }) => Promise<boolean>
  onDelete: (id: string) => void
}) {
  const config = categoryConfig(category)

  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-sm font-semibold text-gray-900">{config.label}</h2>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
          {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-3">{config.description}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {memories.map(m => (
          <MemoryCard key={m.id} memory={m} onSave={onSave} onDelete={onDelete} />
        ))}
      </div>
    </div>
  )
}

// ── Memory Form (create + edit) ──────────────────────────────────────────────

function MemoryForm({ editing, onSave, onCancel }: {
  editing: Memory | null
  onSave: (data: { content: string; category: string; importance: number; id?: string }) => Promise<void>
  onCancel: () => void
}) {
  const [content, setContent] = useState(editing?.content ?? '')
  const [category, setCategory] = useState(editing?.category ?? 'preference')
  const [importance, setImportance] = useState(editing?.importance ?? 3)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim() || saving) return
    setSaving(true)
    try {
      await onSave({
        content: content.trim(),
        category,
        importance,
        ...(editing ? { id: editing.id } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-gray-200 bg-white p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-900">
          {editing ? 'Edit memory' : 'Add a memory'}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors"
        >
          Cancel
        </button>
      </div>

      <textarea
        ref={inputRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="e.g. Always sign off as Coach Mike. / Members respond better to evening messages."
        className="w-full text-sm text-gray-800 border border-gray-200 px-3 py-2 resize-none focus:outline-none focus:border-blue-400"
        rows={2}
      />

      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="text-xs text-gray-700 border border-gray-200 px-2 py-1 focus:outline-none focus:border-blue-400"
          >
            {CATEGORY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">Importance</label>
          <ImportanceDots value={importance} interactive onChange={setImportance} showLabel />
        </div>

        <div className="ml-auto">
          <button
            type="submit"
            disabled={!content.trim() || saving}
            className="text-xs font-medium px-4 py-1.5 text-white transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0063FF' }}
          >
            {saving ? 'Saving...' : editing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ── Suggestion types ──────────────────────────────────────────────────────────

interface Suggestion {
  id: string
  title: string
  description: string
  proposed_change: {
    content: string
    category: string
    scope: string
    importance: number
    targetMemoryId?: string
    memberName?: string
  }
  evidence: { source: string; quote: string; originalContent?: string }
  confidence_score: number
  evidence_strength: string
  created_at: string
}

// ── SuggestionsSection ────────────────────────────────────────────────────────

function SuggestionsSection() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/improvements')
      .then(r => r.json())
      .then(json => { setSuggestions(json.suggestions ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const act = async (id: string, action: 'apply' | 'dismiss') => {
    setActing(id)
    try {
      await fetch('/api/improvements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      setSuggestions(prev => prev.filter(s => s.id !== id))
    } finally {
      setActing(null)
    }
  }

  if (loading || suggestions.length === 0) return null

  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-sm font-semibold text-gray-900">Suggested Memories</h2>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
          {suggestions.length} to review
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Extracted from recent conversations — save what looks right, dismiss the rest.
      </p>
      <div className="flex flex-col gap-2">
        {suggestions.map(s => {
          const catColor = CATEGORY_CONFIG[s.proposed_change.category]?.color ?? '#6B7280'
          const isActing = acting === s.id
          const isUpdate = !!s.proposed_change.targetMemoryId
          return (
            <div
              key={s.id}
              className="px-4 py-3 border border-gray-200 bg-white"
              style={{ borderLeft: `2px solid ${catColor}` }}
            >
              {isUpdate && (
                <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1.5">
                  Updates existing memory
                </p>
              )}
              <p className="text-sm text-gray-800 leading-relaxed mb-1">{s.proposed_change.content}</p>
              {s.evidence?.quote && (
                <p className="text-[11px] text-gray-400 italic mb-2">
                  &ldquo;{s.evidence.quote}&rdquo;
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5"
                  style={{ backgroundColor: `${catColor}15`, color: catColor }}
                >
                  {categoryConfig(s.proposed_change.category).label}
                </span>
                <span className="text-[10px] text-gray-400">
                  {s.evidence_strength} signal
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => act(s.id, 'dismiss')}
                    disabled={isActing}
                    className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40 px-2 py-1"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => act(s.id, 'apply')}
                    disabled={isActing}
                    className="text-[10px] font-semibold text-white px-3 py-1 transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ backgroundColor: '#0063FF' }}
                  >
                    {isActing ? 'Saving...' : isUpdate ? 'Update memory' : 'Save as memory'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MemoriesPanel() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const fetchMemories = () => {
    fetch('/api/memories')
      .then(r => r.json())
      .then(json => {
        setMemories(json.memories ?? [])
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load memories')
        setLoading(false)
      })
  }

  useEffect(() => { fetchMemories() }, [])

  const handleSave = async (data: { content: string; category: string; importance: number }) => {
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: data.content, category: data.category, importance: data.importance }),
    })
    if (res.ok) {
      const json = await res.json()
      if (json.memory) {
        setMemories(prev => [json.memory, ...prev])
      }
    }
    setShowForm(false)
  }

  const handleCardSave = async (id: string, updates: { content: string; category: string; importance: number }): Promise<boolean> => {
    const res = await fetch('/api/memories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    if (res.ok) {
      setMemories(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
      return true
    }
    return false
  }

  const handleDelete = async (id: string) => {
    const res = await fetch('/api/memories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setMemories(prev => prev.filter(m => m.id !== id))
    }
  }

  const handleCancel = () => {
    setShowForm(false)
  }

  // Group by category: known ones first in display order, unknowns after
  const allCategories = [...new Set(memories.map(m => m.category))]
  const ordered = [
    ...KNOWN_ORDER.filter(c => allCategories.includes(c)),
    ...allCategories.filter(c => !KNOWN_ORDER.includes(c)),
  ]
  const grouped = ordered.reduce<Record<string, Memory[]>>((acc, cat) => {
    const items = memories.filter(m => m.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})

  return (
    <div className="overflow-y-auto flex-1">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Memories</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            What the AI knows about your business — used in every agent prompt.
          </p>
        </div>
        {!showForm && !loading && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs font-medium px-3 py-1.5 text-white transition-opacity hover:opacity-80"
            style={{ backgroundColor: '#0063FF' }}
          >
            Add memory
          </button>
        )}
      </div>

      <div className="px-6 py-6">
        <SuggestionsSection />

        {showForm && (
          <MemoryForm editing={null} onSave={handleSave} onCancel={handleCancel} />
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-3 h-3 border border-gray-300 border-t-blue-500 animate-spin" style={{ borderRadius: '50%' }} />
            Loading memories...
          </div>
        )}

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {!loading && !error && memories.length === 0 && !showForm && (
          <div className="border border-dashed border-gray-200 px-6 py-10 text-center">
            <p className="text-sm text-gray-500 mb-1">No memories yet</p>
            <p className="text-xs text-gray-400 max-w-sm mx-auto mb-4">
              Tell the AI about your business, your preferences, or things it should know about your members.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs font-medium px-4 py-1.5 text-white transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0063FF' }}
            >
              Add your first memory
            </button>
          </div>
        )}

        {!loading && Object.entries(grouped).map(([cat, mems]) => (
          <CategorySection key={cat} category={cat} memories={mems} onSave={handleCardSave} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  )
}
