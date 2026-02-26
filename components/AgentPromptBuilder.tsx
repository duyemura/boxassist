'use client'

import { useState, useRef } from 'react'

interface Variation {
  tone: string
  prompt: string
}

interface AgentPromptBuilderProps {
  name: string
  description: string
  systemPrompt: string
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onSystemPromptChange: (v: string) => void
  disabled?: boolean
  namePlaceholder?: string
  descriptionPlaceholder?: string
}

export default function AgentPromptBuilder({
  name,
  description,
  systemPrompt,
  onNameChange,
  onDescriptionChange,
  onSystemPromptChange,
  disabled,
  namePlaceholder = 'e.g. At-Risk Monitor',
  descriptionPlaceholder = 'What should this agent do?',
}: AgentPromptBuilderProps) {
  const [variations, setVariations] = useState<Variation[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const generatingRef = useRef(false)

  const fieldCls = 'w-full text-sm border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:border-blue-400 transition-colors'
  const labelCls = 'text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-1 block'

  const handleGenerate = async () => {
    if (generatingRef.current || !name.trim() || disabled) return
    generatingRef.current = true
    setGenerating(true)
    setGenError('')

    try {
      const res = await fetch('/api/agents/generate-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      const data = await res.json()
      if (!res.ok || !data.variations) throw new Error(data.error ?? 'Generation failed')

      setVariations(data.variations)
      setSelectedIdx(0)
      onSystemPromptChange(data.variations[0].prompt)
    } catch (err: any) {
      setGenError(err.message ?? 'Generation failed')
    } finally {
      setGenerating(false)
      generatingRef.current = false
    }
  }

  const selectVariation = (idx: number) => {
    setSelectedIdx(idx)
    onSystemPromptChange(variations[idx].prompt)
  }

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className={labelCls}>Agent name</label>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          className={fieldCls}
          placeholder={namePlaceholder}
          disabled={disabled}
        />
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>What should it do?</label>
        <textarea
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
          rows={3}
          className={fieldCls + ' resize-none'}
          placeholder={descriptionPlaceholder}
          disabled={disabled}
        />
      </div>

      {/* AI Prompt section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <label className={labelCls} style={{ marginBottom: 0 }}>AI Prompt</label>
            {variations.length > 0 && (
              <span className="text-[10px] text-gray-400">{variations.length} variations</span>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating || !name.trim() || disabled}
            className="text-[10px] font-semibold tracking-widest uppercase transition-colors disabled:opacity-40 flex items-center gap-1"
            style={{ color: generating ? '#0063FF' : '#9CA3AF' }}
            onMouseEnter={e => { if (!generating && name.trim()) (e.currentTarget.style.color = '#0063FF') }}
            onMouseLeave={e => { if (!generating) (e.currentTarget.style.color = '#9CA3AF') }}
          >
            {generating ? (
              <>
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
                Generating…
              </>
            ) : variations.length > 0 ? (
              '+ Generate More'
            ) : (
              'Generate with AI'
            )}
          </button>
        </div>

        {genError && <p className="text-xs text-red-500 mb-2">{genError}</p>}

        {/* Variation cards — horizontal scroll */}
        {variations.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: 'thin' }}>
            {variations.map((v, i) => {
              const active = selectedIdx === i
              return (
                <button
                  key={i}
                  onClick={() => selectVariation(i)}
                  className="flex-shrink-0 w-44 text-left p-3 border transition-colors"
                  style={{
                    backgroundColor: active ? '#F0F6FF' : 'white',
                    borderColor: active ? '#0063FF' : '#E5E7EB',
                    borderLeft: active ? '3px solid #0063FF' : '3px solid transparent',
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5"
                      style={{
                        backgroundColor: active ? 'rgba(0,99,255,0.1)' : '#F3F4F6',
                        color: active ? '#0063FF' : '#6B7280',
                      }}
                    >
                      {v.tone}
                    </span>
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#0063FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{v.prompt}</p>
                </button>
              )
            })}
          </div>
        )}

        {/* Editable prompt textarea */}
        <textarea
          value={systemPrompt}
          onChange={e => { onSystemPromptChange(e.target.value); setSelectedIdx(null) }}
          rows={variations.length > 0 ? 7 : 5}
          className={fieldCls + ' resize-y font-mono text-xs leading-relaxed'}
          placeholder={`Describe what this agent should do, or click "Generate with AI" to write a prompt from your name and description above.`}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
