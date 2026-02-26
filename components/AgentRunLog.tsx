'use client'

import { useEffect, useRef } from 'react'

export type LogEntry = {
  msg: string
  type: 'step' | 'found' | 'done' | 'error'
}

interface AgentRunLogProps {
  agentName: string
  entries: LogEntry[]
  done: boolean
  theme?: 'dark' | 'light'
}

const TYPE_COLOR_DARK: Record<LogEntry['type'], string> = {
  step:  '#6B7280',
  found: '#F59E0B',
  done:  '#22C55E',
  error: '#EF4444',
}

const TYPE_COLOR_LIGHT: Record<LogEntry['type'], string> = {
  step:  '#9CA3AF',
  found: '#D97706',
  done:  '#16A34A',
  error: '#DC2626',
}

export default function AgentRunLog({ agentName, entries, done, theme = 'dark' }: AgentRunLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isLight = theme === 'light'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  const TYPE_COLOR = isLight ? TYPE_COLOR_LIGHT : TYPE_COLOR_DARK
  const bg = isLight ? '#F8F9FB' : '#0D1117'
  const borderColor = isLight ? '#F3F4F6' : 'rgba(255,255,255,0.06)'
  const chevronColor = isLight ? '#D1D5DB' : '#374151'
  const labelColor = isLight ? '#9CA3AF' : '#4B5563'

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: bg }}>
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: labelColor }}>
            {agentName}
          </span>
          {!done && (
            <span className="flex items-center gap-0.5 ml-1">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="w-1 h-1 rounded-full"
                  style={{
                    backgroundColor: '#0063FF',
                    animation: 'dotPulse 1.4s ease-in-out infinite',
                    animationDelay: `${i * 0.16}s`,
                  }}
                />
              ))}
            </span>
          )}
        </div>
        {done && (
          <span className="text-[10px] font-semibold" style={{ color: '#16A34A' }}>
            Analysis complete
          </span>
        )}
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {entries.map((entry, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 text-xs"
            style={{ animation: 'fadeInUp 0.15s ease forwards', opacity: 0 }}
          >
            <span style={{ color: chevronColor, flexShrink: 0, marginTop: 1 }}>›</span>
            <span style={{ color: TYPE_COLOR[entry.type], lineHeight: '1.5' }}>
              {entry.msg}
            </span>
          </div>
        ))}

        {/* Blinking cursor while running */}
        {!done && (
          <div className="flex items-center gap-2.5 text-xs">
            <span style={{ color: chevronColor }}>›</span>
            <span
              className="inline-block w-1.5 h-3"
              style={{
                backgroundColor: '#0063FF',
                animation: 'pulse 1s ease-in-out infinite',
              }}
            />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
