# AI-Native Architecture — Removing Hardcoded Domain Logic

_Why our agents should reason about data instead of running formulas, and how to get there without breaking what works._

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
| Multi-tenant data isolation | `gym_id` scoping is non-negotiable |
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

## The Migration: What Changes

### Phase A: Loosen the Analysis Pipeline

**Current:** `GMAgent.analyzeGym()` runs `scoreChurnRisk()` per member → produces typed `GymInsight[]`

**New:** `GMAgent.analyzeGym()` sends member data + skills + memories to Claude → Claude returns structured insights

```typescript
// Before: 80 lines of scoring formulas
analyzeGym(snapshot: GymSnapshot): GymInsight[] {
  for (const member of snapshot.members) {
    const riskScore = this.scoreChurnRisk(member) // hardcoded formula
    if (riskScore.level === 'low') continue
    insights.push({ type: 'churn_risk', ... })    // hardcoded type
  }
}

// After: AI-driven analysis with structured output
async analyzeGym(snapshot: GymSnapshot, gymId: string): Promise<GymInsight[]> {
  const skills = await loadAllSkills()             // all skill files as context
  const memories = await getMemoriesForPrompt(gymId)
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
async handleEvent(gymId, context, event) {
  switch (event.type) {
    case 'customer.status.changed': return this._handleStatusChanged(...)
    case 'checkin.created': return  // ignored
    case 'appointment.noshowed': return this._handleNoShow(...)
  }
}

// After: AI evaluates event significance
async handleEvent(gymId, context, event) {
  const memories = await getMemoriesForPrompt(gymId)
  const skills = await loadAllSkills()

  const evaluation = await this.deps.claude.evaluate(
    buildEventSystemPrompt(skills, memories),
    `Event received: ${JSON.stringify(event)}\n\nGym context: ${JSON.stringify(context)}\n\nShould we take action? If yes, describe the task.`
  )

  const decision = parseEventDecision(evaluation)
  if (decision.shouldAct) {
    await this._createInsightTask({
      gymId,
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

## The Payoff

1. **Every gym gets personalized analysis** — the AI learns what's normal for *this* gym and flags deviations
2. **New task types without code changes** — the AI invents categories as needed, skill files guide approach
3. **New data sources without rewrites** — any connector that produces `Person`/`Visit`/`Subscription` works
4. **The system gets smarter** — outcomes feed back into memories, memories guide future analysis
5. **Domain-agnostic foundation** — a coworking space, a martial arts school, a dance studio all fit the same model
