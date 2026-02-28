#!/usr/bin/env npx tsx
/**
 * notify-deploy.ts — Called by GitHub Actions after merge to main.
 *
 * Parses commit messages for AGT-XXX issue references,
 * posts a "deployed" comment on each Linear ticket, and
 * transitions them to Done.
 *
 * Usage:
 *   LINEAR_API_KEY=... npx tsx scripts/notify-deploy.ts "fix: handle error (AGT-4)" "https://github.com/.../pull/2" "https://app-orcin-one-70.vercel.app"
 *
 * Args:
 *   $1 — commit messages (newline-separated)
 *   $2 — PR URL (optional)
 *   $3 — deploy URL (optional, defaults to production URL)
 */

import { LinearClient } from '@linear/sdk'

const DEPLOY_URL_DEFAULT = 'https://app-orcin-one-70.vercel.app'
const ISSUE_PATTERN = /AGT-(\d+)/gi

async function main() {
  const commitMessages = process.argv[2] || ''
  const prUrl = process.argv[3] || ''
  const deployUrl = process.argv[4] || DEPLOY_URL_DEFAULT

  if (!process.env.LINEAR_API_KEY) {
    console.log('[notify-deploy] LINEAR_API_KEY not set — skipping')
    process.exit(0)
  }

  if (!process.env.LINEAR_TEAM_ID) {
    console.log('[notify-deploy] LINEAR_TEAM_ID not set — skipping')
    process.exit(0)
  }

  // Extract all AGT-XXX references from commit messages
  const matches = commitMessages.matchAll(ISSUE_PATTERN)
  const identifiers = [...new Set([...matches].map(m => `AGT-${m[1]}`))]

  if (identifiers.length === 0) {
    console.log('[notify-deploy] No AGT-XXX references found in commits')
    process.exit(0)
  }

  console.log(`[notify-deploy] Found issue references: ${identifiers.join(', ')}`)

  const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })

  // Find the "Done" state for our team
  const team = await client.team(process.env.LINEAR_TEAM_ID)
  const statesConnection = await team.states()
  const doneState = statesConnection.nodes.find(s => s.type === 'completed')

  for (const identifier of identifiers) {
    try {
      // Look up issue by identifier (e.g., "AGT-4")
      const issues = await client.issues({
        filter: { identifier: { eq: identifier } } as any,
      })
      const issue = issues.nodes[0]

      if (!issue) {
        console.log(`[notify-deploy] Issue ${identifier} not found — skipping`)
        continue
      }

      // Post deploy comment
      const body = [
        '## 🚀 Deployed to production',
        '',
        ...(prUrl ? [`**PR:** ${prUrl}`] : []),
        `**Live:** ${deployUrl}`,
        '',
        'Fix is live. Marking as done.',
      ].join('\n')

      await client.createComment({ issueId: issue.id, body })
      console.log(`[notify-deploy] Posted deploy comment on ${identifier}`)

      // Transition to Done
      if (doneState) {
        await client.updateIssue(issue.id, { stateId: doneState.id })
        console.log(`[notify-deploy] ${identifier} → Done`)
      }
    } catch (err) {
      console.error(`[notify-deploy] Failed to update ${identifier}:`, err)
      // Continue with other issues — don't fail the whole run
    }
  }

  console.log('[notify-deploy] Done')
}

main().catch(err => {
  console.error('[notify-deploy] Fatal error:', err)
  process.exit(1)
})
