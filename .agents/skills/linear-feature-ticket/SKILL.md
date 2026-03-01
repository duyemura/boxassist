---
name: linear-feature-ticket
description: Write high-quality Linear feature request tickets with clear problem statements, proposed solutions, scope boundaries, and acceptance criteria. Use when proposing new features, enhancements, or capturing product ideas.
triggers:
  - feature
  - feature ticket
  - feature request
  - linear feature
  - enhancement
  - product idea
  - new feature
  - improvement
---

# Linear Feature Ticket Writing

> **Full ticket lifecycle:** See `docs/TICKET-PIPELINE.md` for how all ticket types (bugs, features, suggestions, feedback) flow through the system.

Write feature tickets that clearly separate the problem from the solution, define scope boundaries, and give the implementer everything they need to build the right thing.

**IMPORTANT: Feature tickets are NOT part of the auto-fix pipeline.** Features require deeper thinking, research, competitive analysis, design planning, and architectural consideration. They are written for humans to evaluate, prioritize, plan, and implement deliberately. Never auto-complete, auto-assign, or auto-implement feature tickets.

The feature pipeline is: **capture idea -> write structured ticket -> human reviews and prioritizes -> plan and design -> implement deliberately.**

## When to Use This Skill

- Proposing a new feature or enhancement in Linear
- Converting user suggestions or feedback into actionable feature requests
- Breaking down a large feature into scoped, shippable tickets
- Capturing a product idea with enough context to evaluate and prioritize
- Research and competitive analysis to inform a feature proposal

## Feature Ticket Structure

### Title

Format: `[area] Action-oriented description of the capability`

Rules:
- Start with the affected area in brackets: `[Dashboard]`, `[Agent]`, `[Setup]`, `[API]`, `[Chat]`, `[Email]`, `[Integrations]`
- Use action verbs: "Add", "Support", "Enable", "Show", "Allow"
- Describe the capability, not the implementation
- Keep under 80 characters
- No periods at the end

Good:
- `[Dashboard] Show real-time agent cost tracker per session`
- `[Agent] Support PDF generation from artifact reports`
- `[Setup] Allow custom cron schedule per agent`
- `[Chat] Enable file attachments in owner messages`
- `[Integrations] Add Slack notification channel for agent alerts`

Bad:
- `New feature idea` (too vague)
- `Add a useEffect in AgentChat.tsx to poll costs` (implementation, not capability)
- `It would be cool if agents could do more stuff` (not actionable)
- `Dashboard improvements` (not specific)

### Description Template

```markdown
## Problem
What problem does this solve? Who has this problem? Why does it matter?
Write from the user's perspective. Reference real scenarios or feedback.

## Proposed solution
Describe the desired behavior from the user's perspective. What would they see,
click, or experience? Stay at the UX/capability level, not implementation.

## Scope
### In scope
- Specific thing 1
- Specific thing 2

### Out of scope (for this ticket)
- Thing that's related but separate (create a follow-up ticket)
- Thing that's tempting to include but adds complexity

## Acceptance criteria
- [ ] User can [do specific thing]
- [ ] [Specific state] results in [specific behavior]
- [ ] [Edge case] is handled by [specific behavior]
- [ ] Existing [feature X] is not affected

## Design notes
(Optional) Wireframe, mockup, or text description of the UI.
Reference BRAND.md rules if relevant (no border-radius, no shadows, etc.)

## Technical considerations
(Optional) Known constraints, dependencies, or architectural notes.
Not a full design doc -- just flags for the implementer.

## Open questions
(Optional) Decisions that need to be made before or during implementation.
- Question 1?
- Question 2?
```

### Priority Mapping

| Linear Priority | When to use |
|---|---|
| **Urgent (1)** | Blocking a launch, critical business need, committed deadline |
| **High (2)** | High user impact, frequently requested, enables key workflow |
| **Normal (3)** | Valuable improvement, nice to have, no urgent timeline |
| **Low (4)** | Future consideration, exploratory, minor enhancement |

### Labels

Always apply:
- `enhancement` -- new capability or improvement to existing feature

Add context labels when relevant:
- `dashboard`, `setup`, `agent`, `api`, `chat`, `integrations` -- area labels
- `ux` -- primarily a user experience improvement
- `infra` -- primarily an infrastructure/backend capability
- `p0-launch` -- required for launch / MVP

## Writing Quality Checklist

Before submitting, verify:

- [ ] Problem statement is about the USER'S problem, not the system's limitation
- [ ] Proposed solution describes behavior, not implementation
- [ ] Scope is explicitly bounded -- "out of scope" section prevents scope creep
- [ ] Acceptance criteria are testable (someone could write a test for each one)
- [ ] No implementation details in the title
- [ ] Priority reflects business value, not engineering interest
- [ ] Open questions are actual questions, not rhetorical

## Converting Feedback to Feature Tickets

When a user submits a suggestion via the feedback widget:

1. **Identify the underlying need** -- users describe solutions, not problems. "Add a dark mode button" means "the screen is too bright." Dig for the real need.
2. **Check for existing work** -- search Linear for similar tickets. Link as related or add as a vote/comment if one exists.
3. **Scope it tightly** -- one feature per ticket. If the suggestion implies multiple features, create separate tickets and link them.
4. **Preserve the user's voice** -- quote their exact words in the problem statement. Their language reveals what matters to them.

Example transformation:

**User suggestion:** "it would be nice if I could see how much each agent is costing me"

**Good feature ticket:**
```
Title: [Dashboard] Show per-agent cost breakdown with session history

## Problem
Gym owners have no visibility into how much each agent costs to run.
They can't make informed decisions about which agents to keep active,
adjust, or disable. User feedback: "it would be nice if I could see
how much each agent is costing me"

## Proposed solution
Add a cost summary to each agent card on the dashboard showing:
- Total cost this month
- Average cost per session
- Cost trend (up/down vs last month)

Clicking the cost opens a detail view with session-by-session breakdown:
each session shows date, goal, turns used, tokens consumed, and cost.

## Scope
### In scope
- Per-agent monthly cost on agent cards
- Session cost breakdown detail view
- Cost data from existing session.cost_cents tracking

### Out of scope
- Account-level billing page (separate ticket)
- Budget alerts / cost limits (separate ticket)
- Cost optimization recommendations (future)

## Acceptance criteria
- [ ] Each agent card shows "This month: $X.XX" cost
- [ ] Clicking cost opens session cost breakdown
- [ ] Sessions show: date, goal summary, turn count, cost
- [ ] Cost data loads from agent_sessions.cost_cents
- [ ] Agents with no sessions show "$0.00"
- [ ] Follows BRAND.md (no border-radius, no shadows)

## Design notes
Cost should appear as a subtle micro-label on the agent card,
not a prominent number. Format: `text-[10px] font-semibold
tracking-widest uppercase text-gray-400` per BRAND.md.
Use $X.XX format, gray text, bottom-right of card.

## Technical considerations
- cost_cents on agent_sessions already tracks per-session cost
- Need to aggregate across sessions for the agent-level view
- Consider caching the monthly rollup to avoid N+1 queries

## Open questions
- Should cost include only AI token costs, or also email sending costs?
- Reset monthly or rolling 30 days?
```

## Sizing and Splitting

If a feature feels large, split it:

### Small (1-2 points)
- Single UI change, one API endpoint, one component
- Example: "Show agent cost on card" (read from existing data, display it)

### Medium (3-5 points)
- New UI section + API + some logic
- Example: "Session cost breakdown view" (new page, query, component)

### Large (8+ points) -- SPLIT THIS
If a ticket feels this large, it needs to be broken down:
1. Create an **epic** or **project** in Linear for the overall feature
2. Break into 3-5 smaller tickets, each independently shippable
3. Each sub-ticket should deliver user-visible value on its own
4. Order by dependency: data layer first, then API, then UI

Example split for "Agent cost tracking":
1. `[API] Add cost aggregation query for per-agent monthly cost` (small)
2. `[Dashboard] Show monthly cost on agent cards` (small)
3. `[Dashboard] Add session cost breakdown detail view` (medium)
4. `[Dashboard] Add cost trend indicator on agent cards` (small)

## Templates by Feature Type

### New UI Feature
Focus on: user flow, visual design (BRAND.md compliance), responsive behavior, empty states

### New API Endpoint
Focus on: request/response schema, auth requirements, rate limits, error cases

### New Integration
Focus on: auth flow, data mapping, sync direction (push/pull/both), failure handling

### New Agent Capability
Focus on: tool interface, approval requirements, safety rails, prompt additions

## API Usage

Create feature tickets using the Linear MCP tools:

```
mcp__claude_ai_Linear__create_issue({
  team: "AGT",
  title: "[Dashboard] Show per-agent cost breakdown",
  description: "## Problem\n...",
  priority: 3,
  labels: ["enhancement", "dashboard"]
})
```

Or via the `createFeedbackIssue` function for suggestion-type feedback:

```typescript
import { createFeedbackIssue } from '@/lib/linear'

await createFeedbackIssue({
  type: 'suggestion',
  message: '[Dashboard] Show per-agent cost breakdown\n\n## Problem\n...',
})
```
