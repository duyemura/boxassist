#!/usr/bin/env node
/**
 * Local cron runner — simulates Vercel cron jobs during local development.
 *
 * Usage:
 *   node scripts/cron-local.mjs                   # run all crons once
 *   node scripts/cron-local.mjs process-commands  # run one specific cron
 *   node scripts/cron-local.mjs --watch           # run on schedule (like Vercel)
 *
 * Reads CRON_SECRET from .env.local automatically.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CRONS } from './cron-config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Parse .env.local for CRON_SECRET
function loadEnv() {
  try {
    const contents = readFileSync(join(root, '.env.local'), 'utf8')
    const match = contents.match(/^CRON_SECRET="?([^"\n]+)"?/m)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

const BASE_URL = process.env.LOCAL_URL ?? 'http://localhost:3000'
const CRON_SECRET = process.env.CRON_SECRET ?? loadEnv()

if (!CRON_SECRET) {
  console.error('ERROR: CRON_SECRET not found in .env.local or environment.')
  console.error('Run: vercel env pull .env.local')
  process.exit(1)
}

// CRONS imported from cron-config.mjs — single source of truth

async function runCron(cron) {
  const url = `${BASE_URL}${cron.path}`
  const start = Date.now()
  process.stdout.write(`[cron] ${cron.name} → `)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
    const body = await res.json().catch(() => ({}))
    const ms = Date.now() - start
    if (res.ok) {
      console.log(`${res.status} OK (${ms}ms)`, JSON.stringify(body))
    } else {
      console.log(`${res.status} ERROR (${ms}ms)`, JSON.stringify(body))
    }
  } catch (err) {
    console.log(`FAILED — ${err.message}`)
    console.error('  Is the dev server running? (npm run dev)')
  }
}

const args = process.argv.slice(2)
const watchMode = args.includes('--watch')
const targetName = args.find(a => !a.startsWith('--'))

const targets = targetName
  ? CRONS.filter(c => c.name === targetName)
  : CRONS

if (targets.length === 0) {
  console.error(`Unknown cron: "${targetName}"`)
  console.error(`Available: ${CRONS.map(c => c.name).join(', ')}`)
  process.exit(1)
}

if (watchMode) {
  console.log(`Watching crons against ${BASE_URL} (Ctrl+C to stop)\n`)

  // Wait for the dev server to be reachable before firing crons
  async function waitForServer(maxWaitMs = 30_000) {
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      try {
        await fetch(BASE_URL, { method: 'HEAD' })
        return true
      } catch {
        await new Promise(r => setTimeout(r, 500))
      }
    }
    return false
  }

  const ready = await waitForServer()
  if (!ready) {
    console.error(`Server not reachable at ${BASE_URL} after 30s — starting crons anyway\n`)
  } else {
    console.log(`Server ready — starting crons\n`)
  }

  for (const cron of targets) {
    runCron(cron)
    setInterval(() => runCron(cron), cron.intervalMs)
  }
} else {
  // Run once and exit
  console.log(`Running crons against ${BASE_URL}\n`)
  await Promise.all(targets.map(runCron))
}
