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
- /dashboard → app/dashboard/page.tsx
  - AgentChat.tsx — Interactive chat with agents. Two views: "list" (past conversations sidebar) and "chat" (active conversation). Loads old sessions via loadSession() → GET /api/agents/runs/{sessionId}
  - ActionSlidePanel.tsx — Slide-over panel for task approval/dismissal/escalation
  - AgentList.tsx — Agent cards grid on dashboard
  - AgentRoster.tsx — Agent roster with stats
  - MemoriesPanel.tsx — Business memories viewer
  - CommandStats.tsx — Command execution stats
  - QuickQueue.tsx — Task queue for pending actions
  - ScheduledRuns.tsx — Agent schedule display
- /setup → app/setup/page.tsx — Agent setup wizard (multi-step)

### API Routes
- /api/agents/chat/route.ts — SSE chat endpoint for interactive agent sessions
- /api/agents/run/route.ts — Manual agent run trigger
- /api/agents/[id]/runs/route.ts — List conversation runs for an agent (metadata only)
- /api/agents/runs/[sessionId]/route.ts — Get full session + reconstructed messages + DELETE endpoint
- /api/feedback/route.ts — Feedback widget submission
- /api/dashboard/route.ts — Dashboard data aggregation
- /api/cron/run-analysis/route.ts — Scheduled analysis cron
- /api/setup/recommend/route.ts — Agent recommendation engine
- /api/humanize-message/route.ts — Message humanization via Claude

### Core Libraries
- lib/agents/session-runtime.ts — Session engine: startSession, resumeSession, executeLoop. Stores messages as JSONB in agent_sessions table.
- lib/agents/agent-runtime.ts — Legacy single-call agent runtime (analyzeGymAI)
- lib/agents/GMAgent.ts — GM Agent class with analyzeGym/analyzeGymAI
- lib/skill-loader.ts — Skill file loading, semantic matching via YAML front-matter
- lib/db/memories.ts — Business memory CRUD + prompt injection
- lib/db/tasks.ts — Task management (createInsightTask, getOpenTasksForGym)
- lib/db/commands.ts — Command bus (SendEmail, CreateTask, CloseTask, etc.)
- lib/pushpress-platform.ts — PushPress API connector (ppGet, buildMemberData)
- lib/reply-agent.ts — Inbound reply handling
- lib/linear.ts — Linear integration (ticket creation, lifecycle hooks)
- lib/bug-triage.ts — Stack trace parsing, area classification, auto-fix triage

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

You have a map of the project structure below. Use it to identify relevant files.

${CODEBASE_MAP}

## Output Format

Write your investigation as structured markdown with these sections:

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
How to build this feature — what changes to existing code, what new code is needed. Be specific about which components, API routes, and DB tables are involved.

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

/**
 * Investigate a ticket using Claude HAIKU and post findings as a comment.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function investigateTicket(input: InvestigationInput): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[ticket-investigator] ANTHROPIC_API_KEY not set — skipping')
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

    parts.push('')
    if (isBug) {
      parts.push('Investigate this bug and identify the likely root cause and files involved.')
    } else {
      parts.push('Analyze this request and identify the relevant files, implementation approach, and complexity.')
    }

    const response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 1500,
      system: getSystemPrompt(input.ticketType),
      messages: [{ role: 'user', content: parts.join('\n') }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    const analysis = textBlock && 'text' in textBlock ? textBlock.text : ''

    if (!analysis.trim()) {
      console.log('[ticket-investigator] Empty response from Claude — skipping comment')
      return
    }

    // Post the investigation as a comment on the ticket
    const comment = [
      '## AI Investigation',
      '',
      `_Automated analysis by Claude ${HAIKU}_`,
      '',
      analysis,
    ].join('\n')

    await commentOnIssue(input.issueId, comment)

    // Transition to backlog — investigated and ready for action
    await updateIssueState(input.issueId, 'backlog')
    console.log(`[ticket-investigator] Posted investigation on ${input.issueIdentifier} → backlog`)
  } catch (err) {
    console.error(`[ticket-investigator] Failed to investigate ${input.issueIdentifier}:`, err)
    // Don't propagate — investigation is best-effort
  }
}
