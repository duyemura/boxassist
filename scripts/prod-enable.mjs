#!/usr/bin/env node
/**
 * prod-enable — restore production config when you're ready to go live.
 *
 * What it does:
 *   1. Writes vercel.json with cron schedules (enables Vercel deploys + crons)
 *   2. Updates NEXT_PUBLIC_APP_URL in .env.local to production URL
 *   3. Updates Resend webhook URLs to production URL
 *   4. Updates Linear webhook URL to production URL
 *
 * Usage:
 *   node scripts/prod-enable.mjs
 *   npm run prod:enable
 *
 * After running:
 *   git add vercel.json && git commit -m "chore: enable production crons"
 *   git push
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CRONS, PRODUCTION_URL } from './cron-config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const envPath = join(root, '.env.local')

// ── Helpers ───────────────────────────────────────────────────────────────────

let envContents = readFileSync(envPath, 'utf8')

function getEnvVar(name) {
  const match = envContents.match(new RegExp(`^${name}="?([^"\\n]+)"?`, 'm'))
  return match?.[1]?.trim() ?? null
}

function setEnvVar(name, value) {
  const regex = new RegExp(`^(${name}=).*`, 'm')
  if (regex.test(envContents)) {
    envContents = envContents.replace(regex, `$1"${value}"`)
  } else {
    envContents += `\n${name}="${value}"\n`
  }
}

// ── 1. Write vercel.json ──────────────────────────────────────────────────────

console.log('Writing vercel.json with production cron schedules...')

const vercelConfig = {
  crons: CRONS.map(c => ({
    path: c.path,
    schedule: c.schedule,
  })),
}

const vercelPath = join(root, 'vercel.json')
writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2) + '\n')
console.log(`  ${CRONS.length} crons configured`)

// ── 2. Update .env.local ─────────────────────────────────────────────────────

const oldUrl = getEnvVar('NEXT_PUBLIC_APP_URL') ?? '(none)'
setEnvVar('NEXT_PUBLIC_APP_URL', PRODUCTION_URL)
writeFileSync(envPath, envContents)
console.log(`\nUpdated .env.local:`)
console.log(`  NEXT_PUBLIC_APP_URL: ${oldUrl} → ${PRODUCTION_URL}`)

// ── 3. Update Resend webhooks ─────────────────────────────────────────────────

const RESEND_API_KEY = getEnvVar('RESEND_API_KEY')

if (RESEND_API_KEY) {
  console.log('\nUpdating Resend webhooks to production...')
  try {
    const res = await fetch('https://api.resend.com/webhooks', {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    })
    if (!res.ok) throw new Error(`Resend API ${res.status}`)
    const data = await res.json()
    const webhooks = Array.isArray(data) ? data : (data.data ?? [])

    for (const wh of webhooks) {
      const url = wh.url ?? ''
      const suffix = url.match(/\/api\/webhooks\/\S+/)?.[0]
      if (!suffix) continue

      const newUrl = `${PRODUCTION_URL}${suffix}`
      if (url === newUrl) {
        console.log(`  ${suffix} — already correct`)
        continue
      }

      const updateRes = await fetch(`https://api.resend.com/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: newUrl }),
      })
      if (updateRes.ok) {
        console.log(`  ${suffix} → ${newUrl}`)
      } else {
        console.warn(`  PATCH ${wh.id} failed (${updateRes.status})`)
      }
    }
  } catch (err) {
    console.warn(`  Could not update Resend webhooks: ${err.message}`)
  }
} else {
  console.log('\nSkipping Resend webhook update (no RESEND_API_KEY)')
}

// ── 4. Update Linear webhook ──────────────────────────────────────────────────

const LINEAR_API_KEY = getEnvVar('LINEAR_API_KEY')

if (LINEAR_API_KEY) {
  console.log('\nUpdating Linear webhook to production...')
  try {
    const listRes = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: LINEAR_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `{ webhooks { nodes { id url } } }`,
      }),
    })
    if (!listRes.ok) throw new Error(`Linear API ${listRes.status}`)
    const listData = await listRes.json()
    const hooks = listData.data?.webhooks?.nodes ?? []
    const linearHook = hooks.find(h => h.url?.includes('/api/webhooks/linear'))

    if (linearHook) {
      const newUrl = `${PRODUCTION_URL}/api/webhooks/linear`
      if (linearHook.url === newUrl) {
        console.log('  /api/webhooks/linear — already correct')
      } else {
        const updateRes = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            Authorization: LINEAR_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `mutation($id: String!, $url: String!) {
              webhookUpdate(id: $id, input: { url: $url }) {
                success
              }
            }`,
            variables: { id: linearHook.id, url: newUrl },
          }),
        })
        const updateData = await updateRes.json()
        if (updateData.data?.webhookUpdate?.success) {
          console.log(`  /api/webhooks/linear → ${newUrl}`)
        } else {
          console.warn('  Linear webhook update failed')
        }
      }
    } else {
      console.log('  No Linear webhook found')
    }
  } catch (err) {
    console.warn(`  Could not update Linear webhook: ${err.message}`)
  }
} else {
  console.log('\nSkipping Linear webhook update (no LINEAR_API_KEY)')
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`
Production config restored.

Next steps:
  git add vercel.json
  git commit -m "chore: enable production crons"
  git push
`)
