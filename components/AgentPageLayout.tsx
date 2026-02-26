'use client'

/**
 * AgentPageLayout — the replicable shell for every agent page.
 *
 * Pattern:
 *   Header: agent name · status · last run · execution mode · run button
 *   Body:
 *     Left (60%): scrollable — review queue at top, activity feed below
 *     Right (40%): chat with the agent (fixed, full height)
 *
 * Usage:
 *   <AgentPageLayout
 *     agentName="Retention Agent"
 *     status="active"
 *     lastRunAt={iso}
 *     onRunNow={runScan}
 *     isRunning={running}
 *     executionMode="limited_auto"
 *     queueCount={3}
 *     queueSlot={<ReviewQueue ... />}
 *     feedSlot={<AutoFeed ... />}
 *     chatSlot={<GMChat ... />}
 *   />
 *
 * To add a new agent page: create a new route, pass your agent's
 * queue/feed/chat into this shell. The layout and chrome are identical.
 */

import React from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'idle' | 'running' | 'error'

export interface AgentPageLayoutProps {
  // Header
  agentName: string
  agentDescription?: string
  status: AgentStatus
  lastRunAt?: string
  memberCount?: number
  onRunNow?: () => void
  isRunning?: boolean
  runLabel?: string
  executionMode?: 'manual' | 'limited_auto'

  // Content slots
  queueCount?: number        // shown in "Needs Review · N" header
  queueSlot: React.ReactNode
  feedLabel?: string         // defaults to "Recent Activity"
  feedSlot?: React.ReactNode
  chatSlot: React.ReactNode
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

const STATUS_DOT: Record<AgentStatus, string> = {
  active:  '#22C55E',
  idle:    '#9CA3AF',
  running: '#0063FF',
  error:   '#EF4444',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentPageLayout({
  agentName,
  agentDescription,
  status,
  lastRunAt,
  memberCount,
  onRunNow,
  isRunning,
  runLabel = 'Run now',
  executionMode,
  queueCount,
  queueSlot,
  feedLabel = 'Recent Activity',
  feedSlot,
  chatSlot,
}: AgentPageLayoutProps) {
  const dotColor = STATUS_DOT[isRunning ? 'running' : status]

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#F8F9FB' }}>

      {/* ── Header ── */}
      <header className="flex-shrink-0 px-6 py-3 border-b border-gray-100 bg-white flex items-center gap-4">
        {/* Status dot + name */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              backgroundColor: dotColor,
              boxShadow: isRunning ? `0 0 0 3px ${dotColor}22` : undefined,
            }}
          />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 leading-none">{agentName}</h1>
            {agentDescription && (
              <p className="text-xs text-gray-400 mt-0.5">{agentDescription}</p>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="hidden md:flex items-center gap-3 text-xs text-gray-400">
          {lastRunAt && (
            <span>Last run: {relativeTime(lastRunAt)}</span>
          )}
          {memberCount !== undefined && memberCount > 0 && (
            <>
              <span className="text-gray-200">·</span>
              <span>{memberCount.toLocaleString()} members</span>
            </>
          )}
          {typeof queueCount === 'number' && queueCount > 0 && (
            <>
              <span className="text-gray-200">·</span>
              <span
                className="font-semibold"
                style={{ color: '#EF4444' }}
              >
                {queueCount} need{queueCount !== 1 ? '' : 's'} review
              </span>
            </>
          )}
        </div>

        {/* Execution mode badge */}
        {executionMode === 'limited_auto' && (
          <span
            className="hidden md:block text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 flex-shrink-0"
            style={{ color: '#0063FF', backgroundColor: 'rgba(0,99,255,0.08)' }}
          >
            Limited Auto
          </span>
        )}

        {/* Run button */}
        {onRunNow && (
          <button
            onClick={onRunNow}
            disabled={isRunning}
            className="flex-shrink-0 text-xs font-semibold text-white px-3 py-1.5 transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ backgroundColor: '#0063FF' }}
          >
            {isRunning ? 'Running…' : runLabel}
          </button>
        )}
      </header>

      {/* ── Body: left queue + right chat ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left column — scrollable queue + feed */}
        <div className="flex-1 min-w-0 overflow-y-auto" style={{ maxWidth: '60%' }}>
          <div className="px-6 py-5">

            {/* Needs Review */}
            <section className="mb-8">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">
                {typeof queueCount === 'number' && queueCount > 0
                  ? `Needs Review · ${queueCount}`
                  : 'Needs Review'}
              </p>
              {queueSlot}
            </section>

            {/* Optional feed */}
            {feedSlot && (
              <section>
                <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 mb-3">
                  {feedLabel}
                </p>
                {feedSlot}
              </section>
            )}

          </div>
        </div>

        {/* Right column — chat (desktop only) */}
        <aside
          className="hidden md:flex flex-col flex-shrink-0 border-l border-gray-100 bg-white overflow-hidden"
          style={{ width: '40%' }}
        >
          {chatSlot}
        </aside>

      </div>
    </div>
  )
}
