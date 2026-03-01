# Ticket Pipeline — Bugs, Features, and the Headless Fix Process

How tickets move from creation through investigation to resolution. This document is the source of truth for Claude Code sessions — follow it without asking questions.

## Ticket Types

Four types, classified at creation time and tagged in Linear:

| Type | Linear Label | Priority | Source |
|---|---|---|---|
| `error` | `error` (orange) | 2 (High) | Auto-captured runtime errors from feedback widget |
| `bug` | `bug` (red) | 2 (High) | Manual bug reports |
| `suggestion` | `enhancement` (blue) | 4 (Low) | Feature ideas, improvement requests |
| `feedback` | `feedback` (purple) | 3 (Normal) | General comments, UX notes |

**Area labels** are auto-applied based on stack trace file paths or page URL:

| Area | Files | Label |
|---|---|---|
| Dashboard | `app/dashboard/`, `components/` | `dashboard` |
| API | `app/api/`, `lib/pushpress`, `lib/db/` | `api` |
| Agent Runtime | `lib/agents/`, `lib/task-skills/` | `agent` |
| Setup | `app/setup/` | `setup` |
| Cron | `app/api/cron/` | `cron` |
| Email | `app/api/webhooks/`, `lib/reply-agent` | `email` |
| General | everything else | `api` |

**Pipeline labels** (applied by triage engine or investigator):
- `auto-fixable` — mechanical error with clear stack trace, safe to fix
- `needs-human` — protected files, architecture decisions, vague reports
- `needs-investigation` — applied to all non-stack-trace tickets

---

## The Pipeline

Every ticket follows this flow. The **Linear status** column shows where the ticket sits at each stage.

```
User action or runtime error
    │
    ▼
┌──────────────────────────────┐
│ 1. CAPTURE                   │  POST /api/feedback
│    Save to DB, upload        │  app/api/feedback/route.ts
│    screenshot if present     │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 2. CREATE TICKET             │  lib/linear.ts → createFeedbackIssue()
│    Has stack trace?          │  Linear status: → Triage
│    ├─ YES → buildStructured  │  lib/bug-triage.ts → buildStructuredTicket()
│    │   BugIssue() with       │    parseStackTrace()
│    │   triage, red test      │    classifyArea()
│    │   sketch, area labels   │    triageAutoFixable()
│    │                         │    buildRedTestSketch()
│    └─ NO → createSimple      │
│        Issue() with area     │
│        from URL              │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 3. INVESTIGATE (async)       │  lib/ticket-investigator.ts
│    Claude HAIKU analyzes     │    investigateTicket()
│    the ticket and posts      │
│    structured findings as    │  Uses BUG_SYSTEM_PROMPT for bugs/errors
│    a Linear comment          │  Uses FEATURE_SYSTEM_PROMPT for features
│                              │  Linear status: → Backlog (investigated)
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 4. FIX (bugs only)           │  Trigger: human says "Fix AGT-XX"
│    Red-green-PR cycle        │  Then fully headless — no questions
│    Fully headless — no       │
│    questions asked            │  Linear status: → In Progress (on red test)
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 5. REVIEW & MERGE            │  Human reviews PR
│    CI runs tests             │  Human merges to main
│    Only human step           │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 6. DEPLOY & CLOSE            │  GitHub Actions notify-deploy
│    notify-deploy parses      │  scripts/notify-deploy.ts
│    AGT-XX from commits,      │  Linear status: → Done
│    transitions ticket        │
└──────────────────────────────┘
```

### Linear Status at Each Stage

| Stage | Linear Status | How it gets there |
|---|---|---|
| Ticket created | **Triage** | `createFeedbackIssue()` calls `updateIssueState(id, 'triage')` |
| Investigation posted | **Backlog** | `investigateTicket()` calls `updateIssueState(id, 'backlog')` |
| Red test written | **In Progress** | `documentFixProgress(id, 'red', ...)` calls `updateIssueState(id, 'inProgress')` |
| Fix applied + PR | **In Progress** | stays in progress through green + PR |
| Deployed to production | **Done** | `documentFixProgress(id, 'deployed', ...)` calls `updateIssueState(id, 'done')` |
| Blocked / needs human | **Triage** | stays in triage, labeled `needs-human` |

Steps 1–3 and 6 are fully automated. Step 4 is triggered manually ("Fix AGT-XX") but runs headlessly from there. Step 5 is human review.

---

## Bug Fix Process — Headless Rules

### How it starts

A human says **"Fix AGT-XX"** (or similar). From that point on, the entire process is headless.

### The rules

Follow this process **without asking any questions**. Do not pause for confirmation, do not ask "should I also...", do not propose alternatives. Do not ask which files to change, whether to create a branch, or if the approach looks right. Execute the cycle start to finish, then report what you did.

### Decision framework (when unsure)

- **Two approaches?** Pick the simpler one.
- **Scope unclear?** Fix only the reported bug, nothing else.
- **Multiple files?** Change them. Don't ask for permission.
- **Related issue found?** Note it in the PR description. Don't fix it now.
- **Not sure if it's a bug?** Write the test anyway — if it passes, the report was wrong. Say so.

### Which bugs to fix

**Fix it (auto-fixable):**
- Stack trace points to a specific file + line
- TypeError, ReferenceError, null/undefined access — mechanical errors
- Wrong conditional, off-by-one, missing guard
- API returns wrong status code or response shape
- UI crash with clear error boundary hit
- Test failure with clear assertion mismatch

**Don't fix it (label `needs-human` and stop):**
- Requires a database migration
- Touches security or auth (`lib/auth.ts`, `middleware.ts`, `.env`)
- External API behavior change (PushPress, Anthropic, Resend)
- Architecture decision embedded in the fix
- Performance issue that needs profiling
- Vague report with no error, no screenshot, no repro steps
- Fix would change more than 5 files

When labeling `needs-human`, post a Linear comment explaining what you found and why it needs a human.

### The red-green-PR cycle

**The iron law: no fix without a failing test first.**

```
1. READ the ticket
2. FIND the code (Grep/Glob)
3. RED — write a failing test that proves the bug
4. Run test → MUST FAIL (if it passes, rewrite the test)
5. GREEN — write the minimal fix
6. Run test → MUST PASS
7. Run ALL tests → MUST ALL PASS
8. BRANCH + COMMIT + PR
```

At each stage, document progress on the Linear ticket using lifecycle hooks.

### Linear lifecycle hooks

These are mandatory. Import from `@/lib/linear`:

```typescript
import { documentFixProgress, updateIssueState } from '@/lib/linear'
```

**On RED (failing test written and confirmed failing):**
```typescript
await documentFixProgress(issueId, 'red', {
  testFile: 'lib/__tests__/feedback.test.ts',
  testName: 'rejects screenshot over 2MB',
  output: '<paste vitest failure output>',
})
// Automatically transitions ticket → In Progress
```

**On GREEN (fix applied, all tests pass):**
```typescript
await documentFixProgress(issueId, 'green', {
  testFile: 'lib/__tests__/feedback.test.ts',
  testName: 'rejects screenshot over 2MB',
  totalTests: 827,
  totalPassing: 827,
})
```

**On PR created:**
```typescript
await documentFixProgress(issueId, 'pr', {
  prUrl: 'https://github.com/duyemura/gymagents/pull/42',
  prTitle: 'fix: reject oversized screenshots (AGT-42)',
  branch: 'fix/AGT-42-screenshot-size',
})
```

**On deploy (handled automatically by notify-deploy webhook):**
```typescript
await documentFixProgress(issueId, 'deployed', {
  prUrl: 'https://github.com/duyemura/gymagents/pull/42',
  deployUrl: 'https://app-orcin-one-70.vercel.app',
})
// Automatically transitions ticket → Done
```

### Branch and PR conventions

```bash
# Branch name
fix/AGT-{number}-short-description

# Commit message
fix: {description} (AGT-{number})

# PR title
fix: {description} (AGT-{number})
```

PR body should follow this template:
```markdown
## Bug
[AGT-{n}](linear-url) — {one-line summary}

## Red test
- `{test file}`: "{test name}"
- Failed because: {why it failed before the fix}

## Root cause
{What was wrong and why}

## Fix
{What changed and why}

## Verification
- [x] Red test written and verified failing
- [x] Fix applied, red test now passes
- [x] All {N} existing tests still pass

Fixes AGT-{n}
```

### Safety rails

1. **Never push to main.** Always branch + PR.
2. **All tests must pass** before creating the PR.
3. **Max 5 files** per fix. More than that → label `needs-human`.
4. **Never touch:** `lib/auth.ts`, billing/payments, database migrations, env vars.
5. **If blocked:** label `needs-human` with a comment explaining what you found.

---

## The Code Behind Ticket Creation

### Bug triage engine — `lib/bug-triage.ts`

Deterministic (no AI). Runs synchronously during ticket creation.

| Function | What it does |
|---|---|
| `parseStackTrace(stack)` | Extracts file, line, column, function from JS stack traces. Filters out node_modules and framework internals. |
| `classifyArea(filePath)` | Maps file paths to areas (Dashboard, API, Agent Runtime, etc.) using pattern matching. |
| `triageAutoFixable(errorMsg, frames, ...)` | Determines if a bug is auto-fixable based on error type patterns and protected file list. |
| `buildRedTestSketch(area, topFrame, errorMsg)` | Generates a vitest test template targeting the right file and area. |
| `buildStructuredTicket(input)` | Orchestrates all of the above into a structured Linear ticket with title, description, labels, priority. |

### AI investigation — `lib/ticket-investigator.ts`

Uses Claude HAIKU. Runs asynchronously after ticket creation (fire-and-forget).

| Ticket Type | System Prompt | Output |
|---|---|---|
| `bug` / `error` | `BUG_SYSTEM_PROMPT` | Likely files, root cause hypothesis, investigation steps, red test sketch, classification |
| `suggestion` / `feature` / `feedback` | `FEATURE_SYSTEM_PROMPT` | Relevant files, implementation approach, complexity estimate, considerations |

Both prompts include `CODEBASE_MAP` — a compact map of pages, API routes, core libraries, and key patterns so Claude can identify files without filesystem access.

Investigation results are posted as a structured comment on the Linear ticket with heading "## AI Investigation".

### Linear lifecycle hooks — `lib/linear.ts`

| Function | What it does |
|---|---|
| `createFeedbackIssue(input)` | Routes to structured or simple issue creation based on type + stack trace presence. |
| `ensureLabel(client, teamId, name)` | Creates or finds a Linear label by name. Cached in-memory. |
| `updateIssueState(issueId, state)` | Transitions a ticket to backlog / inProgress / done / cancelled / triage. |
| `commentOnIssue(issueId, body)` | Posts a markdown comment on a Linear ticket. |
| `documentFixProgress(issueId, event, data)` | Posts formatted progress comments (red/green/pr/deployed) and handles state transitions. |

---

## Feature Request Process

Feature tickets follow a different lifecycle than bugs. They are **not auto-fixed** — they require human evaluation, prioritization, and deliberate implementation.

### Current state

Features that arrive via the feedback widget (`type: 'suggestion'`) are:
1. Created as Linear tickets with label `enhancement` + area label + `needs-investigation`
2. Investigated by Claude HAIKU using `FEATURE_SYSTEM_PROMPT`
3. Investigation posted as a comment with: relevant files, implementation approach, complexity, considerations

### What happens next (human-driven)

After investigation:
1. **Human reviews** the ticket and AI investigation
2. **Human prioritizes** — is this worth building? When?
3. **Human plans** — break into smaller tickets if needed, design the approach
4. **Implementation** — may be done by Claude Code, but initiated and scoped by a human

### Feature ticket structure

Use the `linear-feature-ticket` skill for writing feature tickets. Key sections:
- **Problem** — what user problem does this solve?
- **Proposed solution** — described as behavior, not implementation
- **Scope** — explicit in/out boundaries
- **Acceptance criteria** — testable checkboxes
- **Technical considerations** — flags for the implementer

### Feature labels

| Label | When |
|---|---|
| `enhancement` | All feature requests |
| Area label (`dashboard`, `api`, etc.) | Based on where the feature lives |
| `needs-investigation` | All new features (AI investigates) |

---

## Ticket Type Decision Tree

When something comes in and the type isn't clear:

```
Is something broken that used to work?
├─ YES → bug
│   Has a stack trace?
│   ├─ YES → error (auto-captured)
│   └─ NO → bug (manually reported)
│
└─ NO
    Is the user asking for something new?
    ├─ YES → suggestion (feature request)
    └─ NO → feedback (general comment)
```

---

## Environment Variables

| Variable | Required for |
|---|---|
| `LINEAR_API_KEY` | All ticket operations (create, comment, state transitions) |
| `LINEAR_TEAM_ID` | Team-scoped issue creation and label management |
| `ANTHROPIC_API_KEY` | AI investigation (ticket-investigator.ts) |

If `LINEAR_API_KEY` is not set, ticket creation silently returns null — feedback is still saved to the database.
