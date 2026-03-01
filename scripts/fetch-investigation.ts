#!/usr/bin/env npx tsx
/**
 * fetch-investigation.ts — Fetches the AI investigation comment from a Linear ticket.
 *
 * Used by the autofix GitHub Actions workflow to get context before
 * running Claude Code. Outputs the investigation markdown to stdout.
 *
 * Usage:
 *   LINEAR_API_KEY=... npx tsx scripts/fetch-investigation.ts AGT-7
 */

import { LinearClient } from '@linear/sdk'

async function main() {
  const identifier = process.argv[2]
  if (!identifier) {
    console.error('Usage: npx tsx scripts/fetch-investigation.ts <identifier>')
    process.exit(1)
  }

  if (!process.env.LINEAR_API_KEY) {
    console.error('LINEAR_API_KEY not set')
    process.exit(1)
  }

  const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })

  // Look up issue by identifier
  const issues = await client.issues({
    filter: { identifier: { eq: identifier } } as any,
  })
  const issue = issues.nodes[0]
  if (!issue) {
    console.error(`Issue ${identifier} not found`)
    process.exit(1)
  }

  // Get the issue description
  const parts: string[] = []
  parts.push(`## Ticket: ${identifier}`)
  parts.push(`**Title:** ${issue.title}`)
  parts.push('')
  if (issue.description) {
    parts.push('## Description')
    parts.push(issue.description)
    parts.push('')
  }

  // Get comments — look for the AI investigation
  const comments = await issue.comments()
  const investigation = comments.nodes.find(c =>
    c.body.includes('AI Investigation')
  )

  if (investigation) {
    parts.push('## AI Investigation Comment')
    parts.push(investigation.body)
  } else {
    parts.push('## No AI Investigation Found')
    parts.push('No investigation comment was found. Analyze the ticket description directly.')
  }

  // Output to stdout for the workflow to capture
  console.log(parts.join('\n'))
}

main().catch(err => {
  console.error('Error:', err.message || err)
  process.exit(1)
})
