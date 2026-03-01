/**
 * AI-powered ticket investigation agent.
 *
 * After a ticket is created from the feedback widget (bug, feature,
 * or suggestion), this module uses Claude HAIKU to analyze the request,
 * identify relevant files and implementation approaches, and post a
 * structured investigation comment on the Linear ticket.
 *
 * Runs asynchronously — ticket creation returns immediately,
 * investigation happens in the background.
 *
 * Comments are wrapped in <!-- MACHINE:investigation --> markers so the
 * autonomous pipeline can distinguish AI comments from human comments.
 */

import Anthropic from '@anthropic-ai/sdk'
import { HAIKU } from './models'
import { commentOnIssue, updateIssueState } from './linear'

export type TicketType = 'bug' | 'error' | 'feature' | 'suggestion' | 'feedback'

export interface InvestigationInput {
  issueId: string
  issueIdentifier: string
  title: string
  description: string
  ticketType?: TicketType
  pageUrl?: string
  screenshotUrl?: string | null
  navigationHistory?: string[]
}

/**
 * Compact codebase map included in the investigation prompt.
 * Maps page URLs to components and key files so Claude can
 * identify likely sources of bugs without filesystem access.
 */
const CODEBASE_MAP = `## Project Structure (GymAgents)

### Pages & Components
- /dashboard \u2192 app/dashboard/page.tsx
  - AgentChat.tsx \u2014 Interactive chat with agents. Two views: "list" (past conversations sidebar) and "chat" (active conversation). Loads old sessions via loadSession() \u2192 GET /api/agents/runs/{sessionId}
  - ActionSlidePanel.tsx \u2014 Slide-over panel for task approval/dismissal/escalation
  - AgentList.tsx \u2014 Agent cards grid on dashboard
  - AgentRoster.tsx \u2014 Agent roster with stats
  - MemoriesPanel.tsx \u2014 Business memories viewer
  - CommandStats.tsx \u2014 Command execution stats
  - QuickQueue.tsx \u2014 Task queue for pending actions
  - ScheduledRuns.tsx \u2014 Agent schedule display
- /setup \u2192 app/setup/page.tsx \u2014 Agent setup wizard (multi-step)

### API Routes
- /api/agents/chat/route.ts \u2014 SSE chat endpoint for interactive agent sessions
- /api/agents/run/route.ts \u2014 Manual agent run trigger
- /api/agents/[id]/runs/route.ts \u2014 List conversation runs for an agent (metadata only)
- /api/agents/runs/[sessionId]/route.ts \u2014 Get full session + reconstructed messages + DELETE endpoint
- /api/feedback/route.ts \u2014 Feedback widget submission
- /api/dashboard/route.ts \u2014 Dashboard data aggregation
- /api/cron/run-analysis/route.ts \u2014 Scheduled analysis cron
- /api/setup/recommend/route.ts \u2014 Agent recommendation engine
- /api/humanize-message/route.ts \u2014 Message humanization via Claude
- /api/webhooks/linear/route.ts \u2014 Linear webhook: triggers autofix on backlog transition + comment retry

### Core Libraries
- lib/agents/session-runtime.ts \u2014 Session engine: startSession, resumeSession, executeLoop. Stores messages as JSONB in agent_sessions table.
- lib/agents/agent-runtime.ts \u2014 Legacy single-call agent runtime (analyzeGymAI)
- lib/agents/GMAgent.ts \u2014 GM Agent class with analyzeGym/analyzeGymAI
- lib/skill-loader.ts \u2014 Skill file loading, semantic matching via YAML front-matter
- lib/db/memories.ts \u2014 Business memory CRUD + prompt injection
- lib/db/tasks.ts \u2014 Task management (createInsightTask, getOpenTasksForGym)
- lib/db/commands.ts \u2014 Command bus (SendEmail, CreateTask, CloseTask, etc.)
- lib/pushpress-platform.ts \u2014 PushPress API connector (ppGet, buildMemberData)
- lib/reply-agent.ts \u2014 Inbound reply handling
- lib/linear.ts \u2014 Linear integration (ticket creation, lifecycle hooks)
- lib/bug-triage.ts \u2014 Stack trace parsing, area classification, auto-fix triage
- lib/channel-router.ts \u2014 Routes inbound messages to conversations + roles
- lib/ticket-investigator.ts \u2014 AI-powered ticket investigation with structured FIX_BRIEF

### Test Files (map source \u2192 test)
- lib/agents/session-runtime.ts \u2192 lib/__tests__/session-runtime.test.ts
- lib/agents/agent-runtime.ts \u2192 lib/__tests__/agent-runtime.test.ts
- lib/agents/GMAgent.ts \u2192 lib/__tests__/gm-agent.test.ts
- lib/skill-loader.ts \u2192 lib/__tests__/skill-loader.test.ts
- lib/db/memories.ts \u2192 lib/__tests__/memories.test.ts
- lib/db/tasks.ts \u2192 lib/__tests__/tasks.test.ts
- lib/db/commands.ts \u2192 lib/__tests__/commands.test.ts
- lib/reply-agent.ts \u2192 lib/__tests__/reply-agent.test.ts
- lib/linear.ts \u2192 lib/__tests__/linear.test.ts
- lib/bug-triage.ts \u2192 lib/__tests__/bug-triage.test.ts
- lib/ticket-investigator.ts \u2192 lib/__tests__/ticket-investigator.test.ts
- lib/channel-router.ts \u2192 lib/__tests__/channel-router.test.ts
- app/api/webhooks/linear/route.ts \u2192 lib/__tests__/linear-webhook.test.ts
- app/api/feedback/route.ts \u2192 lib/__tests__/feedback-api.test.ts

### Mock Patterns (vitest)
- vi.mock('@anthropic-ai/sdk') \u2014 mock Anthropic client, messages.create returns { content: [{ type: 'text', text }] }
- vi.mock('../linear') \u2014 mock commentOnIssue, updateIssueState
- vi.mock('../supabase') \u2014 mock supabase.from().select/insert/update chains
- vi.stubGlobal('fetch', vi.fn()) \u2014 mock external HTTP calls (GitHub API, etc.)

### Key Patterns
- Messages in agent_sessions.messages stored as Claude API format (role + content blocks)
- reconstructMessages() in /api/agents/runs/[sessionId]/route.ts converts Claude messages to display format
- All DB queries scoped by account_id (multi-tenant)
- Command bus pattern for side effects (SendEmail, CreateTask)
- Skill files in lib/task-skills/*.md with YAML front-matter
- Tests in lib/__tests__/*.test.ts using vitest`

const BUG_SYSTEM_PROMPT = `You are a senior software engineer investigating a bug report for the GymAgents project (Next.js 14 App Router + Supabase + Claude AI).

Your job is to analyze the bug description and identify:
1. Which files are most likely involved
2. What the probable root cause is
3. What investigation steps would confirm the diagnosis
4. A red test sketch (what test would prove the bug exists)
5. Whether the fix is safe for auto-merge or needs human review

You have a map of the project structure below. Use it to identify relevant files.

${CODEBASE_MAP}

## Output Format

IMPORTANT: You MUST include a FIX_BRIEF block at the very top of your response, before any other content. This structured block is machine-parsed by the autofix pipeline.

` + '```' + `
<!-- FIX_BRIEF
target_files:
  - path/to/file.ts
  - path/to/other-file.ts
test_file: lib/__tests__/file.test.ts
area: Dashboard | API | Agent Runtime | Setup | Cron | Email | General
fix_approach: >
  One paragraph describing exactly what needs to change and why.
red_test_sketch: >
  it('should do X when Y', async () => { ... })
confidence: high | medium | low
risk_level: safe | risky
risk_reason: null | "touches auth" | "touches billing" | "5+ files" | "migration needed" | etc
END_FIX_BRIEF -->
` + '```' + `

Risk assessment rules:
- "safe" = 1-4 files, no auth/billing/migration changes, well-understood bug
- "risky" = touches auth, billing, migrations, env vars, 5+ files, or uncertain root cause

Then write the rest of your investigation with these sections:

### Likely Files
List the 2-4 files most likely involved, with a brief reason for each.

### Root Cause Hypothesis
Your best guess at what's wrong, based on the description and your knowledge of the codebase.

### Investigation Steps
3-5 specific steps to confirm the hypothesis (what to check, what to look for).

### Red Test Sketch
A vitest test that would prove the bug exists. Include the test file location.

### Classification
- **Area:** [Dashboard | API | Agent Runtime | Setup | Cron | Email | General]
- **Auto-fixable:** [Yes/No] with reason
- **Severity:** [Critical | High | Medium | Low]

Be concise. Focus on actionable investigation steps, not generic advice.`

const FEATURE_SYSTEM_PROMPT = `You are a senior software engineer analyzing a feature request for the GymAgents project (Next.js 14 App Router + Supabase + Claude AI).

Your job is to analyze the feature request and provide a technical assessment:
1. Which existing files would need to change
2. What new files might need to be created
3. How this feature fits into the existing architecture
4. What the implementation approach should be

You have a map of the project structure below. Use it to identify relevant files.

${CODEBASE_MAP}

## Output Format

Write your analysis as structured markdown with these sections:

### Relevant Files
List the 2-5 existing files most relevant to this feature, with a brief reason for each.

### Implementation Approach
How to build this feature \u2014 what changes to existing code, what new code is needed. Be specific about which components, API routes, and DB tables are involved.

### Complexity Estimate
- **Scope:** [Small (1-2 files) | Medium (3-5 files) | Large (6+ files)]
- **Area:** [Dashboard | API | Agent Runtime | Setup | Cron | Email | General]
- **Dependencies:** Any external services, new packages, or DB migrations needed

### Considerations
Any gotchas, edge cases, or architectural concerns to keep in mind.

Be concise and specific. Reference actual file paths and function names from the codebase map.`

function getSystemPrompt(ticketType?: TicketType): string {
  if (ticketType === 'bug' || ticketType === 'error') return BUG_SYSTEM_PROMPT
  return FEATURE_SYSTEM_PROMPT
}

/** Extract risk_level from a FIX_BRIEF block in the analysis text. */
export function extractRiskLevel(analysis: string): 'safe' | 'risky' {
  const match = analysis.match(/risk_level:\s*(safe|risky)/i)
  return match ? (match[1].toLowerCase() as 'safe' | 'risky') : 'risky'
}

/** Extract the full FIX_BRIEF YAML block from analysis text. Returns null if not found. */
export function extractFixBrief(analysis: string): string | null {
  const match = analysis.match(/<!-- FIX_BRIEF\n([\s\S]*?)END_FIX_BRIEF -->/)
  return match ? match[1].trim() : null
}

/**
 * Investigate a ticket using Claude HAIKU and post findings as a comment.
 * Fire-and-forget \u2014 errors are logged but don't propagate.
 *
 * Posts a <!-- MACHINE:investigation --> comment with structured FIX_BRIEF
 * for the autofix pipeline to consume.
 *
 * @param supplementalContext Optional additional context from human comments or previous attempts
 */
export async function investigateTicket(
  input: InvestigationInput,
  supplementalContext?: string,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[ticket-investigator] ANTHROPIC_API_KEY not set \u2014 skipping')
    return
  }

  try {
    const anthropic = new Anthropic()
    const isBug = input.ticketType === 'bug' || input.ticketType === 'error'
    const typeLabel = isBug ? 'Bug Report' : 'Feature Request'

    // Build the user message with all available context
    const parts: string[] = []
    parts.push(`## ${typeLabel}: ${input.title}`)
    parts.push('')
    parts.push(input.description)

    if (input.pageUrl) {
      parts.push('')
      parts.push(`**Page URL:** ${input.pageUrl}`)
    }

    if (input.navigationHistory?.length) {
      parts.push(`**Navigation path:** ${input.navigationHistory.join(' \u2192 ')}`)
    }

    if (input.screenshotUrl) {
      parts.push('')
      parts.push('A screenshot is available (see ticket). Analyze based on the description.')
    }

    if (supplementalContext) {
      parts.push('')
      parts.push('## Additional Context (from human comments or previous attempts)')
      parts.push(supplementalContext)
    }

    parts.push('')
    if (isBug) {
      parts.push('Investigate this bug and identify the likely root cause and files involved.')
    } else {
      parts.push('Analyze this request and identify the relevant files, implementation approach, and complexity.')
    }

    const response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 2000,
      system: getSystemPrompt(input.ticketType),
      messages: [{ role: 'user', content: parts.join('\n') }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    const analysis = textBlock && 'text' in textBlock ? textBlock.text : ''

    if (!analysis.trim()) {
      console.log('[ticket-investigator] Empty response from Claude \u2014 skipping comment')
      return
    }

    // Wrap in machine marker for the autonomous pipeline to identify
    const comment = [
      '<!-- MACHINE:investigation -->',
      '## AI Investigation',
      '',
      `_Automated analysis by Claude ${HAIKU}_`,
      '',
      analysis,
    ].join('\n')

    await commentOnIssue(input.issueId, comment)

    // Transition to backlog \u2014 investigated and ready for action
    await updateIssueState(input.issueId, 'backlog')
    console.log(`[ticket-investigator] Posted investigation on ${input.issueIdentifier} \u2192 backlog`)
  } catch (err) {
    console.error(`[ticket-investigator] Failed to investigate ${input.issueIdentifier}:`, err)
    // Don't propagate \u2014 investigation is best-effort
  }
}
