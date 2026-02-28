#!/usr/bin/env tsx
/**
 * watch-feedback.ts
 *
 * Polls the feedback table every 15 seconds and prints new entries.
 * Marks displayed entries as 'seen' so they don't repeat.
 *
 * Usage:
 *   npx tsx scripts/watch-feedback.ts
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Parse .env.local
const envFile = readFileSync(join(root, '.env.local'), 'utf8')
const supabaseUrlMatch = envFile.match(/^NEXT_PUBLIC_SUPABASE_URL="?([^"\n]+)"?/m)
const serviceKeyMatch = envFile.match(/^SUPABASE_SERVICE_ROLE_KEY="?([^"\n]+)"?/m)

if (!supabaseUrlMatch || !serviceKeyMatch) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabaseUrl = supabaseUrlMatch[1].replace(/\n$/, '')
const serviceKey = serviceKeyMatch[1].replace(/\n$/, '')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TYPE_COLORS: Record<string, string> = {
  error: '\x1b[31m',     // red
  bug: '\x1b[33m',       // yellow
  feedback: '\x1b[36m',  // cyan
  suggestion: '\x1b[35m', // magenta
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

function formatEntry(entry: any) {
  const color = TYPE_COLORS[entry.type] || '\x1b[37m'
  const time = new Date(entry.created_at).toLocaleTimeString()
  const lines = [
    `${DIM}${time}${RESET} ${color}${BOLD}[${entry.type.toUpperCase()}]${RESET} ${entry.message.slice(0, 200)}`,
  ]
  if (entry.url) {
    lines.push(`  ${DIM}URL: ${entry.url}${RESET}`)
  }
  if (entry.account_id) {
    lines.push(`  ${DIM}Account: ${entry.account_id}${RESET}`)
  }
  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    const meta = { ...entry.metadata }
    // Truncate stack traces in display
    if (meta.stack) meta.stack = meta.stack.slice(0, 150) + '...'
    lines.push(`  ${DIM}Meta: ${JSON.stringify(meta)}${RESET}`)
  }
  return lines.join('\n')
}

async function poll() {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('status', 'new')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Poll error:', error.message)
    return
  }

  if (!data || data.length === 0) return

  // Print entries (oldest first for chronological display)
  const sorted = [...data].reverse()
  for (const entry of sorted) {
    console.log(formatEntry(entry))
    console.log('')
  }

  // Mark as seen
  const ids = data.map((d: any) => d.id)
  const { error: updateErr } = await supabase
    .from('feedback')
    .update({ status: 'seen' })
    .in('id', ids)

  if (updateErr) {
    console.error('Failed to mark as seen:', updateErr.message)
  }
}

// Main loop
console.log(`${BOLD}Watching feedback table...${RESET} (polling every 15s)`)
console.log(`${DIM}Press Ctrl+C to stop${RESET}`)
console.log('')

// Initial poll
poll()

// Poll every 15 seconds
const interval = setInterval(poll, 15_000)

// Graceful shutdown
process.on('SIGINT', () => {
  clearInterval(interval)
  console.log(`\n${DIM}Stopped watching.${RESET}`)
  process.exit(0)
})
