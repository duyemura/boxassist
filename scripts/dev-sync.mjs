#!/usr/bin/env node
/**
 * dev-sync — run this every time you start a new ngrok session.
 *
 * What it does:
 *   1. Reads the active ngrok tunnel URL from localhost:4040
 *   2. Updates NEXT_PUBLIC_APP_URL in .env.local
 *   3. Updates Resend webhook URLs (inbound + sending events) via Resend API
 *   4. Prints the PushPress webhook URL (re-registers automatically on gym connect)
 *
 * Usage:
 *   node scripts/dev-sync.mjs
 *   npm run dev:sync
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const envPath = join(root, '.env.local')

// ── 1. Load .env.local ────────────────────────────────────────────────────────

let envContents = readFileSync(envPath, 'utf8')

function getEnvVar(name) {
  const match = envContents.match(new RegExp(`^${name}="?([^"\\n]+)"?`, 'm'))
  return match?.[1]?.trim() ?? null
}

function setEnvVar(name, value) {
  // Update existing line or append
  const regex = new RegExp(`^(${name}=).*`, 'm')
  if (regex.test(envContents)) {
    envContents = envContents.replace(regex, `$1"${value}"`)
  } else {
    envContents += `\n${name}="${value}"\n`
  }
}

const RESEND_API_KEY = getEnvVar('RESEND_API_KEY')
if (!RESEND_API_KEY) {
  console.error('ERROR: RESEND_API_KEY not found in .env.local')
  console.error('Run: vercel env pull .env.local --environment=production')
  process.exit(1)
}

// ── 2. Get ngrok tunnel URL ───────────────────────────────────────────────────

console.log('Reading ngrok tunnel...')
let ngrokUrl
try {
  const res = await fetch('http://localhost:4040/api/tunnels')
  if (!res.ok) throw new Error(`ngrok API returned ${res.status}`)
  const { tunnels } = await res.json()
  const https = tunnels?.find(t => t.proto === 'https' || t.public_url?.startsWith('https'))
  ngrokUrl = https?.public_url
  if (!ngrokUrl) throw new Error('No HTTPS tunnel found')
} catch (err) {
  console.error(`\nERROR: Could not read ngrok: ${err.message}`)
  console.error('Make sure ngrok is running: ngrok http 3000')
  process.exit(1)
}

console.log(`  Tunnel: ${ngrokUrl}`)

// ── 3. Update .env.local ──────────────────────────────────────────────────────

const oldUrl = getEnvVar('NEXT_PUBLIC_APP_URL') ?? '(none)'
setEnvVar('NEXT_PUBLIC_APP_URL', ngrokUrl)
writeFileSync(envPath, envContents)
console.log(`\nUpdated .env.local:`)
console.log(`  NEXT_PUBLIC_APP_URL: ${oldUrl} → ${ngrokUrl}`)

// ── 4. Update Resend webhooks ─────────────────────────────────────────────────

console.log('\nUpdating Resend webhooks...')

let webhooks = []
try {
  const res = await fetch('https://api.resend.com/webhooks', {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
  })
  if (!res.ok) throw new Error(`Resend API ${res.status}`)
  const data = await res.json()
  webhooks = Array.isArray(data) ? data : (data.data ?? [])
} catch (err) {
  console.warn(`  Could not list Resend webhooks: ${err.message}`)
}

if (webhooks.length === 0) {
  console.log('  No webhooks found — you may need to create them in the Resend dashboard.')
} else {
  for (const wh of webhooks) {
    const url = wh.url ?? ''
    if (!url.includes('/api/webhooks/')) continue  // skip unrelated

    // Determine the path suffix (/api/webhooks/inbound or /api/webhooks/resend, etc.)
    const suffix = url.match(/\/api\/webhooks\/\S+/)?.[0]
    if (!suffix) continue

    const newUrl = `${ngrokUrl}${suffix}`
    if (url === newUrl) {
      console.log(`  ${suffix} — already correct`)
      continue
    }

    try {
      const updateRes = await fetch(`https://api.resend.com/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: newUrl })
      })
      if (updateRes.ok) {
        console.log(`  ${suffix}`)
        console.log(`    ${url}`)
        console.log(`    → ${newUrl}`)
      } else {
        const body = await updateRes.text()
        console.warn(`  PATCH ${wh.id} failed (${updateRes.status}): ${body}`)
        console.log(`  Manually update this webhook in Resend dashboard:`)
        console.log(`    Old: ${url}`)
        console.log(`    New: ${newUrl}`)
      }
    } catch (err) {
      console.warn(`  Failed to update webhook ${wh.id}: ${err.message}`)
    }
  }
}

// ── 5. Summary ────────────────────────────────────────────────────────────────

console.log(`
Done. Your local webhook endpoints:

  Resend inbound:   ${ngrokUrl}/api/webhooks/inbound
  Resend events:    ${ngrokUrl}/api/webhooks/resend
  PushPress:        ${ngrokUrl}/api/webhooks/pushpress
  Gmail Pub/Sub:    ${ngrokUrl}/api/webhooks/gmail

PushPress webhook re-registers automatically next time a gym connects locally.
Gmail Pub/Sub → update the subscriber URL in GCP Console if you need reply-via-Gmail.

Restart your dev server to pick up the new NEXT_PUBLIC_APP_URL.
`)
