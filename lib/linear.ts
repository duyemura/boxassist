/**
 * Linear integration for the GymAgents dev feedback pipeline.
 *
 * Separate workspace — completely isolated from PushPress Linear.
 * Uses @linear/sdk for type-safe API calls.
 *
 * Bug/error tickets are enriched via bug-triage.ts — stack trace parsing,
 * area classification, auto-fixable triage, red test sketch.
 */

import { LinearClient } from '@linear/sdk'
import { buildStructuredTicket, classifyArea, type BugTicketInput } from './bug-triage'
import { investigateTicket } from './ticket-investigator'

let _client: LinearClient | null = null

function getClient(): LinearClient | null {
  if (!process.env.LINEAR_API_KEY) return null
  if (!_client) {
    _client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
  }
  return _client
}

/** Map feedback type to Linear priority (1=Urgent, 2=High, 3=Normal, 4=Low) */
function feedbackPriority(type: string): number {
  switch (type) {
    case 'error': return 2   // High
    case 'bug': return 2     // High
    case 'suggestion': return 4 // Low
    default: return 3        // Normal
  }
}

/** Map feedback type to a label-friendly tag */
function feedbackTag(type: string): string {
  switch (type) {
    case 'error': return 'error'
    case 'bug': return 'bug'
    case 'suggestion': return 'enhancement'
    default: return 'feedback'
  }
}

export interface LinearIssueInput {
  type: string
  message: string
  url?: string | null
  screenshotUrl?: string | null
  metadata?: Record<string, unknown>
  feedbackId?: string
}

export interface LinearIssueResult {
  id: string
  identifier: string // e.g. "GA-123"
  url: string
}

/**
 * Create a Linear issue from feedback.
 * Returns null if Linear is not configured (no API key).
 *
 * For errors/bugs with stack traces: uses buildStructuredTicket() for
 * rich tickets with area classification, red test sketch, auto-fix triage.
 *
 * For manual feedback/suggestions: uses simple format.
 */
export async function createFeedbackIssue(input: LinearIssueInput): Promise<LinearIssueResult | null> {
  const client = getClient()
  if (!client) return null

  const teamId = process.env.LINEAR_TEAM_ID
  if (!teamId) {
    console.warn('[linear] LINEAR_TEAM_ID not set — skipping issue creation')
    return null
  }

  const meta = (input.metadata ?? {}) as Record<string, any>
  const hasStack = !!meta.stack
  const isErrorType = input.type === 'error' || input.type === 'bug'

  // Route: structured ticket for errors/bugs with technical context
  if (isErrorType && hasStack) {
    return createStructuredBugIssue(client, teamId, input, meta)
  }

  // Fallback: simple format for manual feedback/suggestions
  return createSimpleIssue(client, teamId, input, meta)
}

/** Create a rich, structured bug ticket using the triage engine. */
async function createStructuredBugIssue(
  client: LinearClient,
  teamId: string,
  input: LinearIssueInput,
  meta: Record<string, any>,
): Promise<LinearIssueResult | null> {
  const triageInput: BugTicketInput = {
    errorMessage: input.message,
    stack: meta.stack,
    pageUrl: input.url ?? undefined,
    screenshotUrl: input.screenshotUrl ?? undefined,
    navigationHistory: meta.navigationHistory,
    viewport: meta.viewport,
    userAgent: meta.userAgent,
    feedbackId: input.feedbackId,
    feedbackType: input.type,
  }

  const ticket = buildStructuredTicket(triageInput)

  try {
    // Collect all label IDs — type label + triage labels + area label
    const allLabelIds: string[] = []
    for (const labelName of ticket.labels) {
      const ids = await ensureLabel(client, teamId, labelName)
      allLabelIds.push(...ids)
    }

    const result = await client.createIssue({
      teamId,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      labelIds: allLabelIds,
    })

    const issue = await result.issue
    if (!issue) {
      console.error('[linear] Issue creation returned no issue')
      return null
    }

    const issueResult: LinearIssueResult = {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    }

    // Transition to triage — ticket is created and classified
    updateIssueState(issue.id, 'triage').catch(err => {
      console.error('[linear] Failed to transition structured bug to triage:', err)
    })

    // Fire off AI investigation (async, non-blocking)
    investigateTicket({
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      title: ticket.title,
      description: input.message,
      ticketType: (input.type === 'error' ? 'error' : 'bug') as any,
      pageUrl: input.url ?? undefined,
      screenshotUrl: input.screenshotUrl,
      navigationHistory: meta.navigationHistory,
    }).catch(err => {
      console.error('[linear] AI investigation failed for structured bug:', err)
    })

    return issueResult
  } catch (err) {
    console.error('[linear] Failed to create structured issue:', err)
    return null
  }
}

/** Classify area from a page URL for non-stack-trace tickets. */
function areaFromUrl(url?: string | null): string {
  if (!url) return 'General'
  try {
    const pathname = new URL(url).pathname
    if (pathname.startsWith('/dashboard')) return 'Dashboard'
    if (pathname.startsWith('/setup')) return 'Setup'
    if (pathname.startsWith('/api/cron')) return 'Cron'
    if (pathname.startsWith('/api/')) return 'API'
    return 'General'
  } catch {
    return 'General'
  }
}

/** Create a simple issue for manual feedback and suggestions. */
async function createSimpleIssue(
  client: LinearClient,
  teamId: string,
  input: LinearIssueInput,
  meta: Record<string, any>,
): Promise<LinearIssueResult | null> {
  const tag = feedbackTag(input.type)
  const priority = feedbackPriority(input.type)
  const isBugType = input.type === 'bug' || input.type === 'error'

  // Classify area from page URL (even without stack trace)
  const area = areaFromUrl(input.url)

  const descriptionParts: string[] = []

  // Use structured sections for bugs, simple format for feedback/suggestions
  if (isBugType) {
    descriptionParts.push('## What happens')
    descriptionParts.push(input.message)
    descriptionParts.push('')

    descriptionParts.push('## What should happen')
    descriptionParts.push('_To be determined during investigation._')
    descriptionParts.push('')

    if (input.url) {
      descriptionParts.push('## Technical context')
      descriptionParts.push(`- **Page:** ${input.url}`)
      if (meta.navigationHistory?.length) {
        descriptionParts.push(`- **Navigation:** ${meta.navigationHistory.map((p: string) => `\`${p}\``).join(' → ')}`)
      }
      descriptionParts.push(`- **Area:** ${area}`)
      descriptionParts.push('')
    }
  } else {
    descriptionParts.push(input.message)
    descriptionParts.push('')
    descriptionParts.push('---')

    if (input.url) {
      descriptionParts.push(`**Page:** ${input.url}`)
    }
  }

  if (input.feedbackId) {
    descriptionParts.push(`**Feedback ID:** \`${input.feedbackId}\``)
  }

  if (input.screenshotUrl) {
    descriptionParts.push('')
    if (isBugType) {
      descriptionParts.push('## Screenshot')
    } else {
      descriptionParts.push('**Screenshot:**')
    }
    descriptionParts.push(`![Screenshot](${input.screenshotUrl})`)
  }

  if (!isBugType && meta.navigationHistory?.length) {
    descriptionParts.push('')
    descriptionParts.push(`**Navigation history:**`)
    descriptionParts.push(meta.navigationHistory.map((p: string) => `- \`${p}\``).join('\n'))
  }
  if (meta.viewport) {
    descriptionParts.push(`**Viewport:** ${meta.viewport.width}x${meta.viewport.height}`)
  }
  if (meta.userAgent) {
    descriptionParts.push(`**User agent:** ${meta.userAgent}`)
  }
  if (meta.recentErrors) {
    descriptionParts.push('')
    descriptionParts.push(`**Recent errors:**`)
    descriptionParts.push('```')
    descriptionParts.push(meta.recentErrors)
    descriptionParts.push('```')
  }

  // For bugs, add triage section
  if (isBugType) {
    descriptionParts.push('')
    descriptionParts.push('## Triage')
    descriptionParts.push('**Classification:** ⏳ pending AI investigation')
    descriptionParts.push('**Reason:** No stack trace — AI investigation will analyze the bug description and identify likely files.')
  }

  // Title: use area tag for bugs, generic tag for others
  const titleText = input.message.replace(/\n/g, ' ').slice(0, 70)
  const title = isBugType
    ? `[${area}] ${titleText}${input.message.length > 70 ? '...' : ''}`
    : `[${tag}] ${titleText}${input.message.length > 70 ? '...' : ''}`

  try {
    // Collect labels: type label + area label + investigation label for all types
    const allLabelIds: string[] = []
    const labelNames = [tag]
    const areaLabelMap: Record<string, string> = {
      Dashboard: 'dashboard', API: 'api', Setup: 'setup',
      Cron: 'cron', Email: 'email', General: 'api',
    }
    const areaLabel = areaLabelMap[area]
    if (areaLabel && areaLabel !== tag) labelNames.push(areaLabel)
    labelNames.push('needs-investigation')

    for (const name of labelNames) {
      const ids = await ensureLabel(client, teamId, name)
      allLabelIds.push(...ids)
    }

    const result = await client.createIssue({
      teamId,
      title,
      description: descriptionParts.join('\n'),
      priority,
      labelIds: allLabelIds,
    })

    const issue = await result.issue
    if (!issue) {
      console.error('[linear] Issue creation returned no issue')
      return null
    }

    const issueResult: LinearIssueResult = {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    }

    // Transition to triage — ticket is created, awaiting investigation
    updateIssueState(issue.id, 'triage').catch(err => {
      console.error('[linear] Failed to transition simple issue to triage:', err)
    })

    // Fire off AI investigation for all ticket types (async, non-blocking)
    investigateTicket({
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      title,
      description: input.message,
      ticketType: input.type as any,
      pageUrl: input.url ?? undefined,
      screenshotUrl: input.screenshotUrl,
      navigationHistory: meta.navigationHistory,
    }).catch(err => {
      console.error('[linear] AI investigation failed:', err)
    })

    return issueResult
  } catch (err) {
    console.error('[linear] Failed to create issue:', err)
    return null
  }
}

// Label cache to avoid repeated lookups
const labelCache = new Map<string, string[]>()

async function ensureLabel(client: LinearClient, teamId: string, name: string): Promise<string[]> {
  const cacheKey = `${teamId}:${name}`
  if (labelCache.has(cacheKey)) return labelCache.get(cacheKey)!

  try {
    // Search for existing label (team-level or workspace-level)
    const labels = await client.issueLabels({
      filter: { name: { eqi: name } as any },
    })

    const existing = labels.nodes[0]
    if (existing) {
      const ids = [existing.id]
      labelCache.set(cacheKey, ids)
      return ids
    }

    // Create the label
    const colors: Record<string, string> = {
      bug: 'EF4444',       // red
      error: 'F97316',     // orange
      enhancement: '3B82F6', // blue
      feedback: '8B5CF6',  // purple
    }

    const result = await client.createIssueLabel({
      teamId,
      name,
      color: `#${colors[name] || '6B7280'}`,
    })

    const label = await result.issueLabel
    if (label) {
      const ids = [label.id]
      labelCache.set(cacheKey, ids)
      return ids
    }
  } catch (err) {
    console.error('[linear] Label lookup/create failed:', err)
  }

  return []
}

// ── Lifecycle hooks ──────────────────────────────────────────────────────────

/** Cached workflow state IDs for the configured team. */
interface WorkflowStateIds {
  backlog?: string
  inProgress?: string
  done?: string
  cancelled?: string
  triage?: string
}

let _statesCache: WorkflowStateIds | null = null

/** Fetch and cache workflow state IDs for the configured team. */
export async function getWorkflowStates(): Promise<WorkflowStateIds | null> {
  const client = getClient()
  if (!client) return null
  if (_statesCache) return _statesCache

  const teamId = process.env.LINEAR_TEAM_ID
  if (!teamId) return null

  try {
    const team = await client.team(teamId)
    const statesConnection = await team.states()
    const states = statesConnection.nodes

    const map: WorkflowStateIds = {}

    // Map by Linear's semantic type field
    const typeMap: Record<string, keyof WorkflowStateIds> = {
      backlog: 'backlog',
      started: 'inProgress',
      completed: 'done',
      canceled: 'cancelled',
      triage: 'triage',
    }

    for (const state of states) {
      const key = typeMap[state.type]
      if (key && !map[key]) {
        map[key] = state.id
      }
    }

    _statesCache = map
    return map
  } catch (err) {
    console.error('[linear] Failed to fetch workflow states:', err)
    return null
  }
}

type IssueState = 'backlog' | 'inProgress' | 'done' | 'cancelled' | 'triage'

/** Transition a Linear issue to a new workflow state. */
export async function updateIssueState(issueId: string, state: IssueState): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    const states = await getWorkflowStates()
    if (!states) return false

    const stateId = states[state]
    if (!stateId) {
      console.warn(`[linear] No state ID found for "${state}"`)
      return false
    }

    await client.updateIssue(issueId, { stateId })
    return true
  } catch (err) {
    console.error('[linear] Failed to update issue state:', err)
    return false
  }
}

/** Post a markdown comment on a Linear issue. */
export async function commentOnIssue(issueId: string, body: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    await client.createComment({ issueId, body })
    return true
  } catch (err) {
    console.error('[linear] Failed to comment on issue:', err)
    return false
  }
}

/** Progress events that get documented on tickets during the auto-fix pipeline. */
type FixProgressEvent = 'red' | 'green' | 'pr' | 'deployed'

interface RedTestResult {
  testFile: string
  testName: string
  output: string
}

interface GreenTestResult {
  testFile: string
  testName: string
  totalTests: number
  totalPassing: number
}

interface PrCreatedResult {
  prUrl: string
  prTitle: string
  branch: string
}

interface DeployedResult {
  prUrl: string
  deployUrl: string
}

type FixProgressData =
  | RedTestResult
  | GreenTestResult
  | PrCreatedResult
  | DeployedResult

/**
 * Document auto-fix progress on a Linear ticket.
 * Each pipeline stage posts a formatted comment and optionally updates state.
 */
export async function documentFixProgress(
  issueId: string,
  event: FixProgressEvent,
  data: FixProgressData,
): Promise<boolean> {
  let body: string

  switch (event) {
    case 'red': {
      const d = data as RedTestResult
      body = [
        '## 🔴 RED — Failing test written',
        '',
        `**Test file:** \`${d.testFile}\``,
        `**Test name:** "${d.testName}"`,
        '',
        '**Output (confirms test fails):**',
        '```',
        d.output,
        '```',
        '',
        'Test fails as expected — the bug is proven. Proceeding to fix.',
      ].join('\n')

      // Move to In Progress when red test is written
      await updateIssueState(issueId, 'inProgress')
      break
    }

    case 'green': {
      const d = data as GreenTestResult
      body = [
        '## 🟢 GREEN — Fix applied, tests pass',
        '',
        `**Test file:** \`${d.testFile}\``,
        `**Test name:** "${d.testName}"`,
        '',
        `**Full suite:** ${d.totalPassing}/${d.totalTests} tests — all pass ✅`,
        '',
        'Fix verified. Creating PR.',
      ].join('\n')
      break
    }

    case 'pr': {
      const d = data as PrCreatedResult
      body = [
        '## 📦 PR Created',
        '',
        `**PR:** [${d.prTitle}](${d.prUrl})`,
        `**Branch:** \`${d.branch}\``,
        '',
        'Awaiting CI checks and review.',
      ].join('\n')
      break
    }

    case 'deployed': {
      const d = data as DeployedResult
      body = [
        '## 🚀 Deployed to production',
        '',
        `**PR:** ${d.prUrl}`,
        `**Live:** ${d.deployUrl}`,
        '',
        'Fix is live. Marking as done.',
      ].join('\n')

      // Auto-transition to Done on deploy
      await updateIssueState(issueId, 'done')
      break
    }
  }

  return commentOnIssue(issueId, body)
}

// ── Connection validation ────────────────────────────────────────────────────

/**
 * Initialize Linear: fetch teams and validate the API key.
 * Useful for setup/validation.
 */
export async function validateLinearConnection(): Promise<{
  ok: boolean
  workspace?: string
  teams?: { id: string; name: string; key: string }[]
  error?: string
}> {
  const client = getClient()
  if (!client) return { ok: false, error: 'LINEAR_API_KEY not set' }

  try {
    const org = await client.organization
    const teams = await client.teams()

    return {
      ok: true,
      workspace: org.name,
      teams: teams.nodes.map(t => ({ id: t.id, name: t.name, key: t.key })),
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to connect' }
  }
}
