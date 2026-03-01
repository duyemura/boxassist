#!/usr/bin/env node
/**
 * cron-config — single source of truth for all cron schedules.
 *
 * Used by:
 *   - cron-local.mjs (local dev runner)
 *   - prod-enable.mjs (restore production vercel.json + webhooks)
 */

export const PRODUCTION_URL = 'https://app-orcin-one-70.vercel.app'

export const CRONS = [
  {
    name: 'process-commands',
    path: '/api/cron/process-commands',
    schedule: '* * * * *',
    intervalMs: 60_000,
  },
  {
    name: 'tick-workflows',
    path: '/api/cron/tick-workflows',
    schedule: '*/5 * * * *',
    intervalMs: 5 * 60_000,
  },
  {
    name: 'attribute-outcomes',
    path: '/api/cron/attribute-outcomes',
    schedule: '0 * * * *',
    intervalMs: 60 * 60_000,
  },
  {
    name: 'session-monitor',
    path: '/api/cron/session-monitor',
    schedule: '0 * * * *',
    intervalMs: 60 * 60_000,
  },
  {
    name: 'run-analysis',
    path: '/api/cron/run-analysis',
    schedule: '0 */6 * * *',
    intervalMs: 6 * 60 * 60_000,
  },
  {
    name: 'daily-digest',
    path: '/api/cron/daily-digest',
    schedule: '0 14 * * *',
    intervalMs: 24 * 60 * 60_000,
  },
  {
    name: 'extract-memories',
    path: '/api/cron/extract-memories',
    schedule: '0 15 * * *',
    intervalMs: 24 * 60 * 60_000,
  },
]
