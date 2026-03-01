---
name: linear-bug-ticket
description: Write high-quality Linear bug tickets and fix them via the red-green auto-fix pipeline. Every bug fix MUST follow the TDD red-green cycle -- write a failing test first, verify it fails, then fix the code, verify it passes.
triggers:
  - bug
  - bug ticket
  - bug report
  - linear bug
  - file a bug
  - report a bug
  - error report
  - crash report
  - fix bug
  - autofix
---

# Linear Bug Ticket Writing + Fix Reference

> **Full process:** See `docs/TICKET-PIPELINE.md` for the complete headless bug fix pipeline, ticket types, classification labels, Linear lifecycle hooks, triage rules, and decision framework.

This skill covers **writing conventions** — how to format tickets, tests, and PRs.

---

## Writing Bug Tickets

### Title

Format: `[area] Short description of the broken behavior`

Rules:
- Area in brackets: `[Dashboard]`, `[Agent Runtime]`, `[API]`, `[Setup]`, `[Chat]`, `[Email]`, `[Cron]`
- Describe the BROKEN behavior, not the fix
- Under 80 characters
- No periods

Good:
- `[Dashboard] Chart shows previous month data after timezone change`
- `[Agent Runtime] Session stuck in waiting_approval after tool rejection`
- `[API] /api/feedback POST returns 500 when screenshot exceeds 2MB`

Bad:
- `Bug in dashboard` (too vague)
- `Fix the chart` (describes fix, not bug)

### Description Template

```markdown
## What happens
One sentence. Specific broken behavior.

## What should happen
One sentence. Correct expected behavior.

## Steps to reproduce
1. Go to [page/feature]
2. Do [action]
3. Observe [broken result]

## Technical context
- **File:** `app/api/feedback/route.ts:45`
- **Error:** `TypeError: Cannot read property 'id' of undefined`
- **Stack trace:** (code block if available)
- **Browser:** Chrome 120 / macOS / 1440x900

## Screenshot
![Screenshot](url)

## Severity
- **Impact:** All users / specific accounts / edge case
- **Frequency:** Always / intermittent / rare
- **Workaround:** Yes/No + description

## Red test sketch
Describe the failing test that would prove this bug exists:
- Test file: `lib/__tests__/[relevant].test.ts`
- Assertion: `expect([what]).toBe([expected])` but currently gets `[actual]`
```

### Priority Mapping

| Priority | When |
|---|---|
| **Urgent (1)** | Production down, data loss, security, all users |
| **High (2)** | Core feature broken, no workaround, many users |
| **Normal (3)** | Partially broken, workaround exists, subset |
| **Low (4)** | Cosmetic, edge case, minor inconvenience |

### Labels

Type labels:
- `bug` -- confirmed broken behavior
- `error` -- auto-captured runtime error (needs triage)
- `regression` -- previously worked, now broken

Area labels: `dashboard`, `setup`, `agent`, `api`, `email`, `cron`

Pipeline labels:
- `auto-fixable` -- pipeline can handle this
- `needs-human` -- too complex, risky, or ambiguous for auto-fix

---

## Converting Feedback to Bug Tickets

When feedback arrives from the widget:

1. **Extract the bug** -- separate frustration from broken behavior
2. **Check metadata** -- screenshot, navigation history, console errors, viewport
3. **Reproduce mentally** -- follow the navigation history
4. **Sketch the red test** -- what assertion would prove this bug exists?
5. **Set severity** -- based on how many users hit this, not how upset one user is

---

## Test Patterns for This Project

This project uses **Vitest** with these established patterns:

**Mock setup:** Use `vi.hoisted()` for mock refs, `vi.mock()` for module mocks
```typescript
const { mockRef } = vi.hoisted(() => ({
  mockRef: { current: null as any },
}))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => mockRef.current),
}))
```

**Factory functions:** `makeRequest()`, `makeCtx()`, `makeDeps()` for test fixtures

**Chainable Supabase mocks:**
```typescript
function chainable(resolveValue: unknown) {
  const chain: any = new Proxy({}, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch') return undefined
      if (['limit', 'single', 'maybeSingle'].includes(prop as string)) {
        return vi.fn().mockResolvedValue(resolveValue)
      }
      return vi.fn().mockReturnValue(chain)
    }
  })
  return chain
}
```

**Test file location:** `lib/__tests__/{module}.test.ts`

**Run single file:** `npx vitest run lib/__tests__/{file}.test.ts`
**Run all tests:** `npx vitest run`

---

## PR Template for Bug Fixes

```markdown
## Bug
[AGT-{n}](linear-url) -- {one-line summary}

## Red test
The failing test that proves the bug exists:
- `{test file}`: "{test name}"
- Asserts: `expect({what}).toBe({expected})`
- Failed because: {why it failed before the fix}

## Root cause
{What was wrong in the code and why}

## Fix
{What was changed and why this approach}

## Verification
- [x] Red test written and verified failing
- [x] Fix applied, red test now passes
- [x] All {N} existing tests still pass
- [ ] Verified visually (if UI bug)

Fixes AGT-{n}
```

---

## Ticket Creation API

### Auto-captured errors (primary path)

Client-side errors are auto-captured and sent to `/api/feedback`. The feedback API routes errors with stack traces through the **bug triage engine** (`lib/bug-triage.ts`) — see `docs/TICKET-PIPELINE.md` for the full flow.

### Programmatic usage

```typescript
import { createFeedbackIssue } from '@/lib/linear'
await createFeedbackIssue({
  type: 'error',
  message: "TypeError: Cannot read properties of undefined (reading 'id')",
  url: 'https://app-orcin-one-70.vercel.app/dashboard',
  screenshotUrl: 'https://storage.example.com/shot.png',
  metadata: {
    stack: 'TypeError: ...\n    at handleClick (components/Foo.tsx:42:10)',
    viewport: { width: 1440, height: 900 },
    navigationHistory: ['/setup', '/dashboard'],
  },
})
```

### Via Linear MCP tools

```
mcp__claude_ai_Linear__create_issue({
  team: "AGT",
  title: "[Dashboard] Chart shows wrong date range",
  description: "## What happens\n...\n\n## Red test sketch\n...",
  priority: 2,
  labels: ["bug", "dashboard", "auto-fixable"]
})
```
