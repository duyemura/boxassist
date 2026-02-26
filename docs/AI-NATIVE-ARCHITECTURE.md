# AI-Native Architecture — Removing Hardcoded Domain Logic

_Why our agents should reason about data instead of running formulas, and how to get there without breaking what works._

---

## Why This Matters: Any Business, Any Type, Any Future

GymAgents is built on PushPress today. But the fundamental problem we solve — *a business with recurring clients who disengage over time* — is universal. CrossFit boxes, yoga studios, BJJ academies, Pilates studios, martial arts schools, dance studios, coworking spaces, personal training studios — they all share the same pattern: subscribers who pay monthly, show up (or don't), and churn when engagement drops.

**Every piece of hardcoded gym logic is a wall that blocks the next customer.**

When we write `if (daysSinceCheckin > 14)`, we're assuming check-ins are the signal. A yoga studio might track class bookings. A BJJ school tracks belt-test attendance. A personal training studio tracks scheduled sessions. Our 14-day threshold is wrong for all of them.

When we write `task_type: 'churn_risk' | 'win_back' | 'payment_failed'`, we're pre-deciding what matters. A BJJ school where a student misses their belt test has a situation we never anticipated. There's no `missed_milestone` type. The student churns silently because our hardcoded categories didn't see it coming.

When we write `case 'customer.status.changed':` in a switch statement, we're only reacting to events we anticipated, from one platform. A future Mindbody connector fires different event names. Nothing happens.

**The architecture must support the full range of business types from day one** — not as a future refactor, but as a design constraint on every piece of code written now.

The mechanism for this is simple: **AI reasons about data, code handles infrastructure**. The AI can figure out what "at risk" means for a yoga studio without us writing yoga-specific logic. It can interpret a Mindbody event without a PushPress-specific handler. It can identify a milestone moment without a hardcoded category for it. All it needs is the data, the context, and the skill files that describe what we know about retaining clients.

See `docs/SELF_IMPROVING_SYSTEM.md` for how the system accumulates that context over time and gets better for each business without code changes.

---

## The Problem

GymAgents is an AI product built on hardcoded domain logic. The AI drafts messages (good) but a TypeScript function decides *who* to message (bad). The scoring, categorization, timing, and routing are all hand-coded formulas that:

1. **Can't adapt per gym** — a CrossFit box where members come 5x/week has different "at risk" patterns than a yoga studio where 2x/week is normal
2. **Can't learn from outcomes** — we know which outreach worked (member came back) but the scoring formula never updates
3. **Can't extend to new domains** — every concept is gym-specific (`PPCustomer`, `PPCheckin`, `InsightType`). A coworking space with the same fundamental pattern (subscribers who might churn) would need a rewrite
4. **Duplicate what AI does better** — Claude can look at a member's attendance pattern and reason about whether it's concerning. We don't need `if (daysSinceCheckin >= 14) score += 0.45`

## What's Hardcoded Today

### Scoring Formulas (GMAgent.ts `scoreChurnRisk()`)

14 numeric constants decide who's at risk:

```typescript
// These are opinions, not facts
if (daysSinceCheckin >= 14) score += 0.45    // why 14? why 0.45?
if (daysSinceCheckin >= 7)  score += 0.25    // why 7? why 0.25?
if (dropRatio >= 0.7)       score += 0.30    // why 70%? why 0.30?
if (daysToRenewal <= 7)     score += 0.30    // why 7? why 0.30?
```

These thresholds are reasonable defaults but they're wrong for every individual gym. A gym with a 3x/week norm needs different thresholds than a gym with a 1x/week norm.

### Task Type Registry (skill-loader.ts)

11 hardcoded task types, each mapped to a skill file:

```typescript
const TASK_TYPE_TO_FILE: Record<string, string> = {
  churn_risk: 'churn-risk.md',
  win_back: 'win-back.md',
  lead_followup: 'lead-followup.md',
  // ... 8 more
}
```

Adding a new task type requires code changes. The AI can't create new categories of work on its own.

### Event-to-Action Routing (GMAgent.ts `handleEvent()`)

Hardcoded switch statement maps PushPress events to agent actions:

```typescript
switch (event.type) {
  case 'customer.status.changed': ...  // → win_back or churn_risk
  case 'checkin.created': ...          // → ignored
  case 'appointment.noshowed': ...     // → no_show
  default: // silently ignored
}
```

If PushPress adds a new event type, or a different data source sends events with different names, nothing happens.

### Entity Types (pushpress-platform.ts)

Rigid types locked to PushPress's API:

```typescript
interface PPCustomer { id, name: { first, last }, email, role, ... }
interface PPCheckin  { id, customer, timestamp, kind, role, result, ... }
interface PPEnrollment { id, customerId, status, planName, ... }
```

These types assume PushPress. A Mindbody integration, a Wodify integration, or a custom CRM would need completely different types — but the *concepts* are identical: "a person who pays you and shows up to things."

### Autopilot Routing (lib/db/tasks.ts)

Which task types auto-send is hardcoded:

```typescript
const routineTypes = [
  'churn_risk', 'renewal_at_risk', 'win_back',
  'lead_followup', 'lead_going_cold', 'new_member_onboarding',
  'onboarding', 'no_show'
]
```

---

## The AI-Native Model

### Principle: Give the AI Data + Context, Get Back Decisions

Instead of code making decisions and AI executing them, flip it:

```
CURRENT (code-driven):
  PushPress data → TypeScript scoring → hardcoded thresholds → task type → skill file → AI drafts message

AI-NATIVE:
  Connector data → normalized context → AI analyzes (guided by skills + memories) → AI decides what matters → AI acts
```

The AI becomes the decision-maker at every stage. Code handles infrastructure (delivery, safety, storage, auth). Skills and memories provide domain guidance without hardcoding.

### What Stays in Code

| Concern | Why it must be code |
|---------|-------------------|
| Authentication & authorization | Security can't be AI-optional |
| Multi-tenant data isolation | `account_id` scoping is non-negotiable |
| Rate limits & daily send caps | Safety rails need hard guarantees |
| Encryption & credential management | Cryptographic operations |
| Message delivery (email/SMS) | Infrastructure, not decisions |
| Command bus & retry logic | Reliability requires deterministic code |
| Webhook ingestion & parsing | Protocol handling |
| Attribution measurement | "Did they come back?" needs a concrete definition |
| Escalation tripwires | Some things must always escalate (billing issues, injury mentions) |

### What Moves to AI

| Concern | Current | AI-Native |
|---------|---------|-----------|
| **Who needs attention?** | `scoreChurnRisk()` formula | AI reviews member data, guided by skill files |
| **What kind of attention?** | Hardcoded `InsightType` enum | AI describes the situation in natural language, picks relevant skills |
| **How urgent?** | Fixed threshold (≥0.8 = critical) | AI assesses urgency in context (new member vs. 5-year member) |
| **What to say?** | Already AI-driven (good) | No change needed |
| **When to follow up?** | Hardcoded cadence (day 0/3/10) | AI decides based on context + past results |
| **How to categorize?** | `task_type` enum | AI assigns a label (freeform string, not enum) |
| **Which skill applies?** | 1:1 mapping `type → file.md` | AI selects from available skills based on situation |
| **What happened (event)?** | Switch statement per event type | AI receives event + context, decides if action needed |

### How Skills Guide Without Constraining

Skills become **advisors, not controllers**. Instead of:

```
task_type = 'churn_risk' → load churn-risk.md → follow its rules exactly
```

It becomes:

```
AI receives: member data + all available skills + gym memories
AI reasons: "This person's attendance dropped 60% and renewal is in 5 days.
             The churn-risk skill and the renewal skill are both relevant.
             The gym owner prefers casual tone (memory).
             I should reach out with urgency but not alarm."
AI picks: relevant skills to guide its approach
AI outputs: a task with a natural language goal + drafted message
```

The skill files don't change much — they're already natural language. What changes is the *selection mechanism* (AI picks relevant ones) and the *constraint level* (guidance, not hard rules).

---

## Two-Phase Data Loading: Snapshot vs. TaskContext

Pulling all data eagerly for every operation is wrong at scale — and it's not AI-native. The principle is the same as the rest of the architecture: **the AI declares what it needs, code fetches only that.**

There are two fundamentally different phases, each with a different data model:

### Phase 1 — Analysis (cron, eager)

The GM Agent surveys the whole account to *discover* what needs attention. You can't lazy-load here: you don't know what to look for until you've looked. `AccountSnapshot` is the right model for this phase.

```typescript
/**
 * AccountSnapshot — point-in-time survey of an entire account.
 * Built once per cron run. Used by GMAgent.runAnalysis() to find insights.
 * Eager: all members, checkins, enrollments, payment events.
 *
 * No business-type-specific assumptions — works for gyms, studios, any subscription business.
 */
export interface AccountSnapshot {
  accountId: string
  accountName?: string
  members: MemberData[]         // all subscribers + prospects
  recentCheckins: CheckinData[] // last 30 days
  recentLeads: LeadData[]
  paymentEvents: PaymentEvent[]
  capturedAt: string
}
```

`AccountSnapshot` is produced by a **Connector** (PushPress adapter, Mindbody adapter, etc.) and handed to the agent. The agent never fetches data directly — connectors do.

```
Cron → Connector.buildSnapshot(accountId) → AccountSnapshot → GMAgent.runAnalysis() → Insights → Tasks
```

### Phase 2 — Task Execution (per-task, lazy)

Once a Task exists, an agent acts on it. It knows exactly what it's doing: "recover past-due invoice for John Smith." It doesn't need all 500 members. Each task declares its `dataNeeds` and the framework fetches only those fields before execution begins.

```typescript
/**
 * The data needs a task requires to execute.
 * Declared by the AI when creating a task insight — not hardcoded per task type.
 */
export type DataNeed =
  | 'member_profile'      // basic member info (name, email, phone, status)
  | 'payment_history'     // recent charges, failed payments, outstanding balance
  | 'checkin_history'     // visit history for this member
  | 'enrollment_details'  // current plan, billing schedule, next charge date
  | 'conversation_history'// prior outreach and replies for this member
  | 'account_memories'    // learned patterns and preferences for this account

/**
 * TaskContext — lazy-loaded data bundle for a single task execution.
 * Only includes what the task declared it needs via dataNeeds.
 * Produced by AccountDataLoader, consumed by RetentionAgent / SalesAgent.
 */
export interface TaskContext {
  taskId: string
  accountId: string
  member: MemberData                        // always included (who is this task about)
  paymentHistory?: PaymentEvent[]           // if dataNeeds includes 'payment_history'
  checkinHistory?: CheckinData[]            // if dataNeeds includes 'checkin_history'
  enrollmentDetails?: EnrollmentData        // if dataNeeds includes 'enrollment_details'
  conversationHistory?: ConversationTurn[]  // if dataNeeds includes 'conversation_history'
  accountMemories?: string                  // if dataNeeds includes 'account_memories'
}

/**
 * AccountDataLoader — builds a TaskContext by fetching only what the task needs.
 * Provided by the connector layer; agents call this, never the raw API.
 */
export interface AccountDataLoader {
  /**
   * Build a TaskContext for a task execution.
   * Fetches only the data fields declared in task.dataNeeds.
   */
  forTask(
    accountId: string,
    memberId: string,
    dataNeeds: DataNeed[],
  ): Promise<TaskContext>

  /**
   * Build an AccountSnapshot for analysis (full eager load).
   * Called by the cron — not by individual task agents.
   */
  buildSnapshot(accountId: string): Promise<AccountSnapshot>
}
```

### How dataNeeds gets set (AI-native)

When GMAgent creates an insight/task, it includes a `dataNeeds` declaration. The AI decides what data the downstream agent will need — not a hardcoded map from `task_type → data fields`.

```typescript
// GMAgent produces this when creating a task
interface InsightTask {
  accountId: string
  memberId: string
  memberName: string
  memberEmail: string
  type: string          // AI-assigned label, not an enum
  title: string
  detail: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  dataNeeds: DataNeed[] // AI declares: ["member_profile", "payment_history"]
}
```

The execution framework reads `dataNeeds`, calls `AccountDataLoader.forTask()`, and passes the resulting `TaskContext` to the agent. No agent ever decides what data to fetch — the data arrives pre-loaded.

```
Task created → dataNeeds: ["member_profile", "payment_history"]
             → AccountDataLoader.forTask(accountId, memberId, dataNeeds)
             → TaskContext { member, paymentHistory }
             → RetentionAgent.execute(task, context)
```

### Why this is AI-native

The AI declares intent (`dataNeeds`), code handles mechanics (fetching). The agent layer never calls PushPress directly. A future Mindbody connector implements the same `AccountDataLoader` interface — the agents never know or care which connector is running.

```
WRONG: RetentionAgent calls ppGet('/enrollments') directly
RIGHT: RetentionAgent receives TaskContext with pre-loaded enrollment data
```

### Summary

| | `AccountSnapshot` | `TaskContext` |
|---|---|---|
| **Built by** | Connector (cron, per account) | AccountDataLoader (per task) |
| **When** | Analysis discovery phase | Task execution phase |
| **Scope** | Full account — all members | Single member, declared fields only |
| **Loading** | Eager | Lazy — only declared dataNeeds |
| **Used by** | GMAgent.runAnalysis() | RetentionAgent, SalesAgent, etc. |
| **Data volume** | All members × 60-day window | One member × relevant history |

---

## The Migration: What Changes

### Phase A: Loosen the Analysis Pipeline

**Current:** `GMAgent.analyzeGym()` runs `scoreChurnRisk()` per member → produces typed `AccountInsight[]`

**New:** `GMAgent.analyzeGym()` sends member data + skills + memories to Claude → Claude returns structured insights

```typescript
// Before: 80 lines of scoring formulas
analyzeGym(snapshot: AccountSnapshot): AccountInsight[] {
  for (const member of snapshot.members) {
    const riskScore = this.scoreChurnRisk(member) // hardcoded formula
    if (riskScore.level === 'low') continue
    insights.push({ type: 'churn_risk', ... })    // hardcoded type
  }
}

// After: AI-driven analysis with structured output
async analyzeGym(snapshot: AccountSnapshot, accountId: string): Promise<AccountInsight[]> {
  const skills = await loadAllSkills()             // all skill files as context
  const memories = await getMemoriesForPrompt(accountId)
  const memberSummaries = summarizeMembers(snapshot) // structured data, not types

  const analysis = await this.deps.claude.evaluate(
    buildAnalysisSystemPrompt(skills, memories),
    buildAnalysisUserPrompt(memberSummaries, snapshot)
  )

  return parseStructuredInsights(analysis)          // AI chose types, priorities, actions
}
```

**Key:** The AI still outputs structured data (JSON with type, priority, member info). But the *decisions* about who needs attention and why are made by the AI, not by formulas.

**Keep `scoreChurnRisk()` as a fallback/validation** — don't delete it. Use it as a sanity check: if the AI says "low risk" but the formula says "critical," flag it. This gives us a safety net during migration.

### Phase B: Flexible Task Types

**Current:** `task_type` is effectively an enum that drives behavior (skill loading, autopilot routing, follow-up cadence).

**New:** `task_type` is a freeform string that the AI assigns. It's a *label*, not a behavioral switch.

```typescript
// Before: type drives everything
const skillFile = TASK_TYPE_TO_FILE[task.task_type]  // 1:1 mapping
const isRoutine = routineTypes.includes(task.task_type)

// After: AI-assigned label, skills selected by relevance
const relevantSkills = await selectRelevantSkills(task.goal, task.context)
const isRoutine = await assessRoutineLevel(task)  // AI judges, or simple heuristics on priority
```

**Skill selection becomes semantic:** Instead of `churn_risk → churn-risk.md`, the system looks at the task's goal and context, matches against skill file descriptions, and loads the most relevant ones. Multiple skills can apply to one task.

Skill files get a brief header describing when they apply:

```markdown
---
applies_when: "member attendance has dropped or they haven't visited recently"
domain: "retention"
---
# Churn Risk — Re-engagement Playbook
...
```

### Phase C: Normalize the Entity Model

**Current:** Everything speaks `PPCustomer`, `PPCheckin`, `PPEnrollment` — PushPress-specific types.

**New:** Connectors normalize into generic domain concepts:

```typescript
// Generic domain types (connector-agnostic)
interface Person {
  id: string
  name: string
  email: string
  phone?: string
  role: 'subscriber' | 'prospect' | 'former' | 'staff'
  subscribedSince?: string
  subscriptionValue?: number    // monthly $ value
  metadata: Record<string, unknown>  // connector-specific extras
}

interface Visit {
  id: string
  personId: string
  timestamp: number
  activityName?: string
  metadata: Record<string, unknown>
}

interface Subscription {
  id: string
  personId: string
  status: 'active' | 'at_risk' | 'cancelled' | 'paused'
  planName?: string
  monthlyValue: number
  startedAt: string
  metadata: Record<string, unknown>
}
```

Each connector adapter (Phase 8) normalizes its data into these types. PushPress adapter maps `PPCustomer → Person`, `PPCheckin → Visit`, `PPEnrollment → Subscription`. A future Mindbody adapter does the same mapping.

**The analysis pipeline never touches connector-specific types.** It works with `Person`, `Visit`, `Subscription` — concepts that apply to any subscription business.

### Phase D: AI-Driven Event Handling

**Current:** `handleEvent()` has a switch statement mapping specific PushPress event names to handler methods.

**New:** Events are normalized by connectors (Phase 8), then the AI decides what to do:

```typescript
// Before: hardcoded event routing
async handleEvent(accountId, context, event) {
  switch (event.type) {
    case 'customer.status.changed': return this._handleStatusChanged(...)
    case 'checkin.created': return  // ignored
    case 'appointment.noshowed': return this._handleNoShow(...)
  }
}

// After: AI evaluates event significance
async handleEvent(accountId, context, event) {
  const memories = await getMemoriesForPrompt(accountId)
  const skills = await loadAllSkills()

  const evaluation = await this.deps.claude.evaluate(
    buildEventSystemPrompt(skills, memories),
    `Event received: ${JSON.stringify(event)}\n\nGym context: ${JSON.stringify(context)}\n\nShould we take action? If yes, describe the task.`
  )

  const decision = parseEventDecision(evaluation)
  if (decision.shouldAct) {
    await this._createInsightTask({
      accountId,
      insight: decision.insight,  // AI-generated, not hardcoded
    })
  }
}
```

**Specific event handlers like `_handleStatusChanged()` become skill file content:**

```markdown
---
applies_when: "a member's status changes to cancelled or paused"
trigger_events: ["status_changed"]
---
# Win-Back — Cancelled Member Re-engagement
When a member cancels, evaluate whether to reach out...
```

---

## What NOT to Change

1. **Attribution** — "Did they come back within 14 days?" is a business rule, not an AI decision. Keep it in code. (The window could become configurable per gym, but the measurement logic stays deterministic.)

2. **Safety rails** — Daily send limits, escalation on billing/injury, opt-out enforcement. These are guardrails, not decisions.

3. **Infrastructure** — Command bus, webhooks, cron scheduling, email delivery. These are plumbing.

4. **The skill files themselves** — They're already natural language. They just need a metadata header for semantic selection and the constraint that they're guidance, not hard rules.

5. **The task lifecycle** — `open → awaiting_reply → resolved` is a state machine, not a domain assumption. Keep it.

---

## Migration Sequence

```
Phase A: AI-driven analysis
  ├── Add Claude analysis call alongside existing scoreChurnRisk()
  ├── Compare outputs for first N runs (shadow mode)
  ├── When confident, make Claude primary, formula secondary (validation)
  └── Eventually: remove formula, keep as test fixture

Phase B: Flexible task types (can run parallel with A)
  ├── Add skill file headers (applies_when, domain)
  ├── Build semantic skill selector (match goal → skills)
  ├── Change skill-loader to accept multiple skills per task
  └── task_type becomes AI-assigned label, not behavioral enum

Phase C: Entity normalization (depends on Phase 8 connectors)
  ├── Define generic Person/Visit/Subscription types
  ├── PushPress adapter normalizes to generic types
  ├── Analysis pipeline uses generic types
  └── Future connectors normalize to same types

Phase D: AI-driven events (depends on A + C)
  ├── Event handlers become skill file content
  ├── AI evaluates event significance
  ├── Connector webhook normalization (Phase 8.6)
  └── Remove hardcoded switch statement
```

**Phase A and B should happen now — before we build more task types and scoring logic on top of the current hardcoded foundation.**

Phase C and D depend on the connector framework (Phase 8) and can wait.

Phase E: Two-phase data loading (can run parallel with A + B)
  ├── AccountSnapshot interface defined (done)
  ├── Define DataNeed type + TaskContext interface
  ├── Build AccountDataLoader (PushPress implementation wraps ppGet)
  ├── Add dataNeeds field to InsightTask / DB tasks table
  ├── Wire task execution: read dataNeeds → call forTask() → pass TaskContext
  └── Remove direct ppGet calls from agent layer

---

## Cost Considerations

Moving analysis from TypeScript formulas to Claude calls adds AI cost:

| Operation | Current Cost | AI-Native Cost |
|-----------|-------------|----------------|
| Score 100 members | $0 (TypeScript) | ~$0.02 (Haiku batch) |
| Score 500 members | $0 | ~$0.08 |
| Event evaluation | $0 | ~$0.005 per event |

At $0.08 per analysis run × 4 runs/day × 500 gyms = **~$160/month** at scale. Trivial compared to the $97-197/month revenue per gym.

**Optimization:** Batch member analysis into a single Claude call (send all 100 members in one prompt, get back the flagged ones). Don't evaluate every event — pre-filter obvious noise (checkin.created for active member = skip) with cheap heuristics, only send ambiguous events to Claude.

---

## New Code Checklist

Before writing or merging any new code, verify against this list:

**Stop and reconsider if you are:**
- [ ] Adding a numeric threshold (`> 14 days`, `score += 0.45`) — the AI should assess what's abnormal for this business
- [ ] Adding a new value to an `InsightType` or `task_type` enum — is this a categorization the AI should make?
- [ ] Adding a `case 'some.event':` to a switch statement — can the AI evaluate this event in context?
- [ ] Writing gym/member/checkin language inside an agent class — belongs in a skill file, not in code
- [ ] Using `PPCustomer`, `PPCheckin`, or other connector-specific types in the agent layer — these belong only in the connector layer
- [ ] Hardcoding a message cadence (`day 0, day 3, day 10`) — the AI should decide timing based on context
- [ ] Creating a constant like `const COACH_VOICE = '...'` — belongs in a skill file or business memory

**These are correct to hardcode:**
- [x] Security: `account_id` scoping, auth checks, encryption
- [x] Safety rails: daily send limits, opt-out enforcement, escalation tripwires
- [x] Infrastructure: command bus, retry logic, webhook handling, cron scheduling
- [x] Attribution: "did they return within 14 days?" — needs a concrete, consistent definition
- [x] Command types: `SendEmail`, `SendSMS`, `CreateTask` — these are plumbing actions, not decisions

**Ask before writing:**
> "Should the AI be reasoning about this, or does this genuinely belong in code?"

If it's domain knowledge (what's risky, what's urgent, what to say, when to act) → AI reasons from context.
If it's infrastructure (how to deliver, how to store, how to retry, how to secure) → hardcode it.

---

## The Payoff

1. **Any gym type works without new code** — CrossFit, yoga, BJJ, Pilates, martial arts — the AI reads the data and context, no gym-specific handlers required
2. **Future verticals work from day one** — coworking spaces, salons, studios — same architecture, different connector and skill files
3. **Every business gets personalized analysis** — the AI learns what's normal for *this* business and flags deviations, not what our thresholds assume
4. **New situations without code changes** — the AI invents task descriptions as needed, skill files guide approach, no enum to update
5. **New data sources without rewrites** — any connector that produces `Person`/`Visit`/`Subscription` works immediately
6. **The system gets smarter over time** — outcomes feed back into memories, memories guide future analysis — see `docs/SELF_IMPROVING_SYSTEM.md`
