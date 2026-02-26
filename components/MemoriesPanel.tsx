'use client'

import { useEffect, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Memory {
  id: string
  category: 'preference' | 'member_fact' | 'gym_context' | 'learned_pattern'
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

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: 'AI', color: '#0063FF' },
  owner: { label: 'Owner', color: '#374151' },
  system: { label: 'System', color: '#6B7280' },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImportanceDots({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5"
          style={{
            backgroundColor: i <= value ? '#0063FF' : '#E5E7EB',
          }}
        />
      ))}
    </div>
  )
}

function MemoryCard({ memory }: { memory: Memory }) {
  const source = SOURCE_LABELS[memory.source] ?? SOURCE_LABELS.system
  const date = new Date(memory.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div
      className="px-4 py-3 border border-gray-100 bg-white"
      style={{ borderLeft: `2px solid ${CATEGORY_CONFIG[memory.category]?.color ?? '#E5E7EB'}` }}
    >
      <p className="text-sm text-gray-800 leading-relaxed">{memory.content}</p>
      <div className="flex items-center gap-3 mt-2">
        <ImportanceDots value={memory.importance} />
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

function CategorySection({ category, memories }: { category: string; memories: Memory[] }) {
  const config = CATEGORY_CONFIG[category]
  if (!config) return null

  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-sm font-semibold text-gray-900">{config.label}</h2>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
          {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-3">{config.description}</p>
      <div className="flex flex-col gap-1">
        {memories.map(m => <MemoryCard key={m.id} memory={m} />)}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MemoriesPanel() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/memories')
      .then(r => r.json())
      .then(json => {
        setMemories(json.memories ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError('Failed to load memories')
        setLoading(false)
      })
  }, [])

  // Group by category in a fixed display order
  const order: Memory['category'][] = ['gym_context', 'preference', 'member_fact', 'learned_pattern']
  const grouped = order.reduce<Record<string, Memory[]>>((acc, cat) => {
    const items = memories.filter(m => m.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})

  return (
    <div className="overflow-y-auto flex-1">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100">
        <h1 className="text-lg font-semibold text-gray-900">Memories</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          What the AI has learned about your business — used in every agent prompt.
        </p>
      </div>

      <div className="px-6 py-6">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="w-3 h-3 border border-gray-300 border-t-blue-500 animate-spin" style={{ borderRadius: '50%' }} />
            Loading memories…
          </div>
        )}

        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="border border-dashed border-gray-200 px-6 py-10 text-center">
            <p className="text-sm text-gray-500 mb-1">No memories yet</p>
            <p className="text-xs text-gray-400 max-w-sm mx-auto">
              Memories are created automatically when you connect your gym, run an analysis, or the AI picks up facts during member conversations.
            </p>
          </div>
        )}

        {!loading && Object.entries(grouped).map(([cat, mems]) => (
          <CategorySection key={cat} category={cat} memories={mems} />
        ))}
      </div>
    </div>
  )
}
