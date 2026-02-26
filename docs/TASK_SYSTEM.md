# Agentic Task System — Architectural Spec

> This is the backbone. Every agent, trigger, conversation, and outcome flows through this system.

## 1. Core Principles

**Every action has a gate. Every gate has a budget. Every budget has an enforced limit.**

The AI never gets unlimited authority. The system is designed so that the worst-case failure mode is "too cautious" (escalates everything to the owner), never "too aggressive" (sends wrong/harmful messages unchecked).

### The Three Guarantees

1. **No member receives more than N messages per week from the system** — regardless of how many tasks target them. This is a hard, unskippable rate limit.
2. **No task can exceed its budget** — every task has a message budget, a time budget, and a turn budget. When any is exhausted, the task closes or escalates. No exceptions.
3. **Every decision is logged with reasoning** — every state transition, every AI evaluation, every message sent has a paper trail. The owner can always see WHY something happened.

---

## 2. What Is a Task?

A task is **a goal + a budget + a conversation**.

```
Task = {
  goal:    "Re-engage Sarah Johnson who hasn't visited in 18 days"
  budget:  { messages: 3, days: 14, turns: 6 }
  agent:   "retention"
  context: { member data, risk scores, history }
}
```

The agent's job: achieve the goal within the budget. If it can't, it closes the task or escalates to the owner. It never exceeds the budget.

---

## 3. State Machine

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
     [trigger]      ▼                                              │
         ┌──── pending_review ────┐                                │
         │      (needs human)     │                                │
         │           │            │                                │
         │      [approve]    [skip]                                │
         │           │            │                                │
         │           ▼            ▼                                │
         │        ready      cancelled ◄─────────────────────┐    │
         │           │                                       │    │
    [auto-approved]  │                                       │    │
         │           │                                       │    │
         ▼           ▼                                       │    │
         ├───► executing ◄──────────────────────┐            │    │
         │        │                             │            │    │
         │   [send message]                     │            │    │
         │        │                        [reply received]  │    │
         │        ▼                        [follow-up due]   │    │
         │     waiting ─────────────────────────┘            │    │
         │        │                                          │    │
         │        ├── [goal achieved] ──► completed          │    │
         │        ├── [budget exhausted + no signal] ──► cancelled ┘
         │        ├── [budget exhausted + patient cadence]       │
         │        │         │                                    │
         │        │         ▼                                    │
         │        │      dormant ── [outcome signal] ──► completed
         │        │         │                                    │
         │        │         └── [dormant_max_days] ──► cancelled ┘
         │        ├── [needs human] ──► escalated
         │        │                        │
         │        │                   [human guidance]
         │        │                        │
         │        └────────────────────────┘
         │                                  │
         └──────────────────────────────────┘
```

### States

| State | Meaning | Who acts next? |
|-------|---------|----------------|
| `pending_review` | Created, waiting for owner approval | **Owner** |
| `ready` | Approved (or auto-approved), queued for execution | **System** (next cron tick) |
| `executing` | Agent is actively working — sending a message, evaluating a reply | **System** |
| `waiting` | Message sent, waiting for member reply or follow-up timer | **Member** (or timer) |
| `dormant` | All follow-up touches exhausted, but still watching for outcome signals | **System** (periodic check) |
| `completed` | Goal achieved or task closed normally | Nobody — done |
| `escalated` | Agent is uncertain, needs owner input | **Owner** |
| `cancelled` | Dismissed, timed out, or budget exhausted | Nobody — done |

### Valid Transitions

```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending_review: ['ready', 'cancelled'],
  ready:          ['executing', 'cancelled'],
  executing:      ['waiting', 'completed', 'escalated', 'cancelled'],
  waiting:        ['executing', 'completed', 'escalated', 'cancelled', 'dormant'],
  dormant:        ['executing', 'completed', 'cancelled'],  // can wake up on signal or member reply
  completed:      [],  // terminal
  escalated:      ['executing', 'cancelled'],  // owner can re-engage or close
  cancelled:      [],  // terminal
}
```

### Transition Triggers

| From → To | Trigger | Who |
|-----------|---------|-----|
| `pending_review → ready` | Owner clicks "Approve" | Owner |
| `pending_review → cancelled` | Owner clicks "Skip" | Owner |
| `ready → executing` | Cron picks up ready task | System |
| `executing → waiting` | Outbound message sent | System |
| `waiting → executing` | Member reply received OR follow-up timer fires | System |
| `waiting → dormant` | All follow-up touches exhausted AND cadence.onExhaustion = 'dormant' | System |
| `executing → completed` | AI determines goal achieved (concrete commitment, checkin detected) | Agent |
| `executing → escalated` | AI confidence < 50, complaint detected, billing issue, 5+ turns | Agent |
| `executing → cancelled` | Budget exhausted (messages, days, or turns) | System |
| `waiting → cancelled` | All touches exhausted AND cadence.onExhaustion = 'cancel' | System |
| `waiting → escalated` | All touches exhausted AND cadence.onExhaustion = 'escalate' | System |
| `dormant → completed` | Outcome signal detected (checkin, payment, reactivation) | System (attribution cron) |
| `dormant → executing` | Member reply received (they come back after radio silence) | System |
| `dormant → cancelled` | `dormant_max_days` exceeded with no signal | System (cron) |
| `escalated → executing` | Owner provides guidance, re-engages | Owner |
| `escalated → cancelled` | Owner decides to close | Owner |

---

## 4. Schema Changes

### Additions to `agent_tasks`

```sql
-- Budget enforcement (the core safety mechanism)
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS budget_messages_max   INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS budget_messages_used  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_turns_max      INT NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS budget_turns_used     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_expires_at     TIMESTAMPTZ,

-- Execution tracking
  ADD COLUMN IF NOT EXISTS execution_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at      TIMESTAMPTZ DEFAULT NOW(),

-- Follow-up cadence tracking
  ADD COLUMN IF NOT EXISTS followup_touch_index  INT NOT NULL DEFAULT 0,  -- which touch we're on (0 = initial, 1 = first follow-up, etc.)
  ADD COLUMN IF NOT EXISTS dormant_at            TIMESTAMPTZ,             -- when task entered dormant state
  ADD COLUMN IF NOT EXISTS dormant_check_at      TIMESTAMPTZ,             -- next dormant outcome check
  ADD COLUMN IF NOT EXISTS dormant_expires_at    TIMESTAMPTZ,             -- hard deadline for dormant tasks

-- Trigger provenance
  ADD COLUMN IF NOT EXISTS trigger_type          TEXT,  -- 'cron_analysis' | 'webhook' | 'manual' | 'gm_chat'
  ADD COLUMN IF NOT EXISTS trigger_event_id      TEXT,  -- reference to source event

-- Confidence (promote from context.confidence to a real column for querying)
  ADD COLUMN IF NOT EXISTS confidence            INT,   -- 0-100, set at creation and updated per evaluation

-- Parent-child grouping
  ADD COLUMN IF NOT EXISTS parent_task_id        UUID REFERENCES agent_tasks(id);

-- Index for the task executor cron
CREATE INDEX IF NOT EXISTS idx_tasks_ready
  ON agent_tasks (account_id, status, created_at)
  WHERE status IN ('ready', 'waiting', 'dormant');

-- Index for per-member rate limiting
CREATE INDEX IF NOT EXISTS idx_tasks_member_active
  ON agent_tasks (member_email, status, created_at)
  WHERE status NOT IN ('completed', 'cancelled');

-- Update status CHECK to include new states
ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_status_check
  CHECK (status IN (
    'open', 'awaiting_reply', 'awaiting_approval', 'in_progress',  -- legacy (still valid)
    'pending_review', 'ready', 'executing', 'waiting', 'dormant',  -- canonical
    'completed', 'resolved', 'escalated', 'cancelled'              -- terminal
  ));
```

### Additions to `gyms`

```sql
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS execution_mode        TEXT NOT NULL DEFAULT 'manual'
    CHECK (execution_mode IN ('manual', 'limited_auto')),
  ADD COLUMN IF NOT EXISTS member_weekly_limit    INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS daily_send_limit       INT NOT NULL DEFAULT 15;
```

### New table: `task_type_definitions` (optional — can also be code-only)

Not strictly needed. Task type definitions live in code as a TypeScript registry (see section 5). If you later want gym owners to customize budgets per task type, add this table then.

---

## 5. Task Type Registry

Every task type is defined in a single registry. **Adding a new task type = adding an entry here + a skill file.** No schema changes, no new tables, no new cron jobs.

### 5.0 The Task Type Contract

A task type definition is the **formal spec** for how one kind of work interfaces with the task system. It's the contract between the task type and the pipeline — if the contract is complete, the pipeline handles everything else.

```typescript
// lib/task-types.ts

export interface TaskTypeDef {
  // ── Identity ──
  type: string                     // unique key: 'churn_risk', 'win_back', etc.
  label: string                    // human-readable: 'At-Risk Member'
  description: string              // one sentence: 'Reach out to members showing signs of disengagement'

  // ── Classification ──
  category: 'communication' | 'staff_todo' | 'research' | 'automation' | 'recurring'
  assignmentType: 'agent' | 'owner' | 'coach' | 'staff' | 'system'
  agent: string                    // default assigned agent: 'retention', 'sales', 'gm'

  // ── Goal (see §5.2) ──
  goal: GoalDef                    // what "done" means for this task type

  // ── Budget ──
  priority: 'critical' | 'high' | 'medium' | 'low'
  budget: {
    maxMessages: number            // max outbound emails/SMS (0 for non-comm tasks)
    maxDays: number                // auto-expire after N days
    maxTurns: number               // max AI reasoning turns (0 for automation tasks)
  }

  // ── Cadence ──
  followUp: FollowUpCadence        // when and how to follow up (see §5.1)

  // ── Safety ──
  autoThreshold: number            // confidence >= this → auto-execute (if gym allows)
  escalationTriggers: string[]     // conditions that ALWAYS require human review

  // ── Instructions ──
  skillFile: string                // path to the skill/instruction .md file (see §37)
  systemPrompt?: string            // inline fallback if skill file doesn't exist (deprecated — use skillFile)

  // ── Completion ──
  outcomeSignals: string[]         // what counts as success: 'checkin', 'payment', 'reply_positive'
  deliverableType?: 'none' | 'report' | 'plan' | 'member_profile' | 'data_export'

  // ── Recurrence (recurring category only) ──
  recurrence?: {
    cron: string                   // cron expression: '0 8 * * 1' (Mondays at 8am)
    maxInstances: number           // safety cap
  }
}

/**
 * GoalDef — the formal definition of what "done" means for a task type.
 *
 * Goals are NOT binary. A churn_risk task isn't simply "done" or "not done."
 * The member might: come back enthusiastically (best), come back once (good),
 * say they'll come back (okay), not respond (neutral), or get angry (bad).
 * The goal model captures this range.
 */
export interface GoalDef {
  // What are we trying to achieve? (used in AI prompts and dashboard)
  summary: string                    // "Re-engage a member who hasn't visited recently"

  // How does the system know we're done? (see §5.2 for details)
  completionType: 'signal' | 'judgment' | 'deliverable' | 'human_confirms' | 'composite'

  // For signal-based completion: concrete external events that mean success
  signals?: GoalSignal[]

  // For judgment-based completion: what the AI evaluates
  judgmentCriteria?: string          // prompt fragment: "The member has expressed clear intent to return"

  // For deliverable-based: what must be produced
  deliverableSpec?: string           // "A structured member profile with risk factors, history, and recommendation"

  // Outcome spectrum: what are all the possible endings? (not just success/failure)
  outcomes: GoalOutcome[]
}

/**
 * A concrete signal that indicates goal completion (or partial completion).
 * Multiple signals can contribute to the same goal.
 */
export interface GoalSignal {
  type: string                       // 'checkin' | 'payment_succeeded' | 'reactivation' | 'trial_booked' | etc.
  weight: number                     // 0-100: how much this signal contributes to goal completion
  completesGoal: boolean             // true = this signal alone is enough to complete the task
  verificationWindow: number         // days after outreach to check for this signal
}

/**
 * One possible outcome of a task. Every task type defines ALL its possible endings
 * so the system, the AI, and the owner all share the same vocabulary.
 */
export interface GoalOutcome {
  code: string                       // 'retained' | 'verbal_only' | 'unresponsive' | 'churned' | etc.
  label: string                      // 'Member Retained' | 'Verbal Commitment Only' | etc.
  type: 'positive' | 'neutral' | 'negative'
  description: string                // when does this outcome apply?
  attributeRevenue: boolean          // should we count revenue for this outcome?
  revenueMultiplier?: number         // 1.0 = one month, 3.0 = three months (win-back recovery value)
}
```

### 5.2 Goal Types: Not All Goals Are Binary

The `completionType` field defines HOW the system determines if a task is done:

| Type | Who decides | Example | Binary? |
|------|------------|---------|---------|
| **signal** | System (data) | Checkin detected, payment succeeded, membership reactivated | Yes — signal exists or it doesn't |
| **judgment** | AI (evaluation) | "Member expressed intent to return", "Conversation resolved positively" | No — confidence score, can be fuzzy |
| **deliverable** | AI (production) | Research report produced, plan created | Yes — deliverable exists or it doesn't, but quality is fuzzy |
| **human_confirms** | Human (clicks "done") | Staff to-do completed, owner handled manually | Yes — human says done |
| **composite** | Mix of above | Signal OR judgment, whichever comes first | No — multiple paths to completion |

**Most real tasks are `composite`.** A churn_risk task completes if:
- The member checks in (signal — definitive), OR
- The member replies positively and the AI judges the conversation resolved (judgment — fuzzy), OR
- The owner clicks "Mark resolved" (human_confirms — definitive)

The first signal to fire wins. But they have different confidence levels and different attribution value.

### 5.3 The Outcome Spectrum

Every task type defines its full range of possible endings. This replaces the ad-hoc outcome strings scattered through earlier sections.

Example for `churn_risk`:

```typescript
outcomes: [
  {
    code: 'retained',
    label: 'Member Retained',
    type: 'positive',
    description: 'Member checked in within 14 days of outreach',
    attributeRevenue: true,
    revenueMultiplier: 1.0,
  },
  {
    code: 'verbal_commitment',
    label: 'Verbal Commitment',
    type: 'positive',
    description: 'Member said they would return but no checkin yet. Provisional — downgrades to neutral after 14 days with no signal.',
    attributeRevenue: true,     // initially
    revenueMultiplier: 0.5,     // half credit until verified
  },
  {
    code: 'engaged_conversation',
    label: 'Engaged in Conversation',
    type: 'neutral',
    description: 'Member replied and engaged but made no commitment. Conversation was positive but inconclusive.',
    attributeRevenue: false,
  },
  {
    code: 'self_resolved',
    label: 'Self-Resolved',
    type: 'positive',
    description: 'Member came back before we reached out (detected by stale guard).',
    attributeRevenue: false,     // we didn't cause this
  },
  {
    code: 'unresponsive',
    label: 'No Response',
    type: 'neutral',
    description: 'All follow-up touches exhausted with no reply and no checkin.',
    attributeRevenue: false,
  },
  {
    code: 'opted_out',
    label: 'Opted Out',
    type: 'negative',
    description: 'Member requested to stop receiving messages.',
    attributeRevenue: false,
  },
  {
    code: 'churned',
    label: 'Confirmed Churn',
    type: 'negative',
    description: 'Member cancelled membership after or during outreach. Our intervention failed or made things worse.',
    attributeRevenue: false,
  },
  {
    code: 'escalated_unresolved',
    label: 'Escalated (Unresolved)',
    type: 'neutral',
    description: 'Escalated to owner and never resolved. May indicate a complex situation.',
    attributeRevenue: false,
  },
]
```

**Why this matters:**
1. The AI knows exactly what outcomes to evaluate against — no guessing.
2. The dashboard shows outcome distribution per task type: "This month: 12 retained, 5 verbal, 8 unresponsive, 1 churned."
3. Revenue attribution uses `revenueMultiplier` instead of a flat number.
4. Provisional outcomes (`verbal_commitment`) can be automatically downgraded by the attribution cron.
5. The owner's thumbs-up/down (§27) maps to "agree/disagree with this outcome code."

### 5.4 Goal Evaluation in the AI Prompt

The goal definition feeds directly into the AI's evaluation prompt:

```typescript
function buildGoalPrompt(goalDef: GoalDef, outcomes: GoalOutcome[]): string {
  const outcomeList = outcomes
    .map(o => `- "${o.code}" (${o.type}): ${o.description}`)
    .join('\n')

  return `
GOAL: ${goalDef.summary}

POSSIBLE OUTCOMES (choose the most accurate one):
${outcomeList}

EVALUATION RULES:
${goalDef.completionType === 'judgment' || goalDef.completionType === 'composite'
  ? goalDef.judgmentCriteria ?? 'Use your best judgment based on the conversation.'
  : 'This task completes when a concrete signal is detected. Do not close it based on conversation alone.'}

Rate your confidence (0-100) in the outcome you chose. If you're below 60, recommend 'wait_and_verify' or 'escalate' instead of completing the task.
`
}
```

The AI isn't making up outcomes — it's selecting from a predefined list that the task type author defined. This keeps evaluation consistent across all instances of the same task type.

```

/**
 * Follow-up cadence — defines WHEN follow-ups happen, not just how many.
 *
 * The intervals array defines the delay (in days) between each touch.
 * The agent uses the touch index to determine tone/approach.
 * After all touches are exhausted, the task's onExhaustion determines what happens.
 */
export interface FollowUpCadence {
  intervals: number[]              // days between touches. [3, 5, 7] = touch 2 at day 3, touch 3 at day 8, touch 4 at day 15
  toneProgression: string[]        // tone hint per touch: ['friendly', 'direct', 'final']
  onExhaustion: 'cancel' | 'escalate' | 'dormant'  // what happens when all touches are used up
  dormantCheckDays?: number        // if onExhaustion='dormant', check for outcome signals every N days
  dormantMaxDays?: number          // if onExhaustion='dormant', give up entirely after N days
}

export const CADENCES = {
  // Standard: 3 touches over ~2 weeks, then done
  standard: {
    intervals: [3, 5, 7],
    toneProgression: ['friendly_checkin', 'direct_offer_help', 'final_open_door'],
    onExhaustion: 'cancel' as const,
  },

  // Urgent: faster cadence, escalate if no response
  urgent: {
    intervals: [1, 2, 3],
    toneProgression: ['friendly_urgent', 'direct_followup', 'escalation_warning'],
    onExhaustion: 'escalate' as const,
  },

  // Patient: longer intervals, go dormant instead of closing
  patient: {
    intervals: [5, 10, 14],
    toneProgression: ['warm_checkin', 'gentle_followup', 'no_pressure_final'],
    onExhaustion: 'dormant' as const,
    dormantCheckDays: 7,
    dormantMaxDays: 60,
  },

  // Slow burn: few touches, long window (win-back, onboarding)
  slow_burn: {
    intervals: [3, 10, 21],
    toneProgression: ['personal_note', 'different_angle', 'final_door_open'],
    onExhaustion: 'dormant' as const,
    dormantCheckDays: 14,
    dormantMaxDays: 90,
  },

  // Single shot: one message, then monitor for outcome (reviews, notifications)
  single_shot: {
    intervals: [],
    toneProgression: [],
    onExhaustion: 'cancel' as const,
  },
}

export const TASK_TYPES: Record<string, TaskTypeDef> = {

  // ── Full example: churn_risk ──────────────────────────────────────────
  // Every field is shown. Other task types follow the same pattern.

  churn_risk: {
    type: 'churn_risk',
    label: 'At-Risk Member',
    description: 'Reach out to members showing signs of disengagement',
    category: 'communication',
    assignmentType: 'agent',
    agent: 'retention',
    goal: {
      summary: 'Re-engage a member who hasn\'t visited recently',
      completionType: 'composite',
      signals: [
        { type: 'checkin', weight: 100, completesGoal: true, verificationWindow: 14 },
        { type: 'reply_positive', weight: 60, completesGoal: false, verificationWindow: 14 },
      ],
      judgmentCriteria: 'The member has expressed a clear, specific intent to return (named a day, mentioned a class, etc). Vague positivity ("yeah maybe") does NOT count.',
      outcomes: [
        { code: 'retained', label: 'Member Retained', type: 'positive', description: 'Member checked in within 14 days of outreach', attributeRevenue: true, revenueMultiplier: 1.0 },
        { code: 'verbal_commitment', label: 'Verbal Commitment', type: 'positive', description: 'Member said they would return. Provisional — downgrades after 14 days with no checkin.', attributeRevenue: true, revenueMultiplier: 0.5 },
        { code: 'engaged_conversation', label: 'Engaged Conversation', type: 'neutral', description: 'Replied positively but made no commitment.', attributeRevenue: false },
        { code: 'self_resolved', label: 'Self-Resolved', type: 'positive', description: 'Member came back before outreach sent.', attributeRevenue: false },
        { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'All touches exhausted, no reply, no checkin.', attributeRevenue: false },
        { code: 'opted_out', label: 'Opted Out', type: 'negative', description: 'Member requested to stop receiving messages.', attributeRevenue: false },
        { code: 'churned', label: 'Confirmed Churn', type: 'negative', description: 'Member cancelled during or after outreach.', attributeRevenue: false },
        { code: 'escalated_unresolved', label: 'Escalated (Unresolved)', type: 'neutral', description: 'Escalated to owner, never resolved.', attributeRevenue: false },
      ],
    },
    priority: 'high',
    budget: { maxMessages: 3, maxDays: 14, maxTurns: 6 },
    followUp: CADENCES.standard,
    autoThreshold: 75,
    escalationTriggers: ['member_tenure_over_1_year', 'monthly_value_over_200'],
    skillFile: 'lib/task-skills/churn-risk.md',
    outcomeSignals: ['checkin', 'reply_positive'],
  },

  // ── Remaining types: abbreviated, same structure ──────────────────────

  win_back: {
    type: 'win_back',
    label: 'Win-Back',
    description: 'Re-engage a member who has cancelled their membership',
    category: 'communication',
    assignmentType: 'agent',
    agent: 'retention',
    goal: {
      summary: 'Bring a cancelled member back',
      completionType: 'composite',
      signals: [
        { type: 'reactivation', weight: 100, completesGoal: true, verificationWindow: 30 },
        { type: 'reply_positive', weight: 50, completesGoal: false, verificationWindow: 30 },
      ],
      judgmentCriteria: 'The member has expressed genuine interest in returning — not just politeness.',
      outcomes: [
        { code: 'recovered', label: 'Member Recovered', type: 'positive', description: 'Membership reactivated', attributeRevenue: true, revenueMultiplier: 3.0 },
        { code: 'interested', label: 'Interested', type: 'positive', description: 'Expressed interest but hasn\'t reactivated yet', attributeRevenue: false },
        { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'No reply after all touches', attributeRevenue: false },
        { code: 'declined', label: 'Declined', type: 'negative', description: 'Member explicitly said no', attributeRevenue: false },
        { code: 'opted_out', label: 'Opted Out', type: 'negative', description: 'Requested no further contact', attributeRevenue: false },
      ],
    },
    priority: 'high',
    budget: { maxMessages: 3, maxDays: 30, maxTurns: 4 },
    followUp: CADENCES.slow_burn,
    autoThreshold: 80,
    escalationTriggers: ['cancellation_reason_complaint', 'cancellation_reason_billing', 'member_tenure_over_2_years'],
    skillFile: 'lib/task-skills/win-back.md',
    outcomeSignals: ['reactivation', 'reply_positive'],
  },

  lead_followup: {
    type: 'lead_followup',
    label: 'Lead Follow-up',
    description: 'Nurture a new lead toward booking a trial or first visit',
    category: 'communication',
    assignmentType: 'agent',
    agent: 'sales',
    goal: {
      summary: 'Get the lead to book a trial or visit the gym',
      completionType: 'composite',
      signals: [
        { type: 'trial_booked', weight: 100, completesGoal: true, verificationWindow: 21 },
        { type: 'checkin', weight: 100, completesGoal: true, verificationWindow: 21 },
      ],
      judgmentCriteria: 'The lead has committed to a specific date/time to visit.',
      outcomes: [
        { code: 'converted', label: 'Lead Converted', type: 'positive', description: 'Trial booked or first checkin', attributeRevenue: true, revenueMultiplier: 1.0 },
        { code: 'engaged', label: 'Engaged', type: 'positive', description: 'Replying, asking questions, but hasn\'t committed', attributeRevenue: false },
        { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'No reply', attributeRevenue: false },
        { code: 'not_interested', label: 'Not Interested', type: 'negative', description: 'Lead explicitly declined', attributeRevenue: false },
      ],
    },
    priority: 'medium',
    budget: { maxMessages: 5, maxDays: 21, maxTurns: 8 },
    followUp: CADENCES.patient,
    autoThreshold: 70,
    escalationTriggers: [],
    skillFile: 'lib/task-skills/lead-followup.md',
    outcomeSignals: ['trial_booked', 'reply_positive', 'checkin'],
  },

  payment_recovery: {
    type: 'payment_recovery',
    label: 'Payment Recovery',
    description: 'Notify a member about a failed payment in a non-embarrassing way',
    category: 'communication',
    assignmentType: 'agent',
    agent: 'retention',
    goal: {
      summary: 'Recover a failed payment without embarrassing the member',
      completionType: 'composite',
      signals: [
        { type: 'payment_succeeded', weight: 100, completesGoal: true, verificationWindow: 7 },
      ],
      judgmentCriteria: 'The member has acknowledged the issue and indicated they will update payment. But do NOT mark complete until payment actually succeeds.',
      outcomes: [
        { code: 'recovered', label: 'Payment Recovered', type: 'positive', description: 'Payment succeeded', attributeRevenue: true, revenueMultiplier: 1.0 },
        { code: 'self_resolved', label: 'Self-Resolved', type: 'positive', description: 'Payment succeeded before outreach sent', attributeRevenue: false },
        { code: 'acknowledged', label: 'Acknowledged', type: 'neutral', description: 'Member acknowledged but payment still failing', attributeRevenue: false },
        { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'No reply, payment still failing', attributeRevenue: false },
        { code: 'cancelled', label: 'Member Cancelled', type: 'negative', description: 'Member cancelled instead of fixing payment', attributeRevenue: false },
      ],
    },
    priority: 'critical',
    budget: { maxMessages: 2, maxDays: 7, maxTurns: 4 },
    followUp: CADENCES.urgent,
    autoThreshold: 90,
    escalationTriggers: ['always'],
    skillFile: 'lib/task-skills/payment-recovery.md',
    outcomeSignals: ['payment_succeeded'],
  },

  onboarding: {
    type: 'onboarding',
    label: 'New Member Onboarding',
    description: 'Welcome a new member and help them build the habit in their first 30 days',
    category: 'communication',
    assignmentType: 'agent',
    agent: 'retention',
    goal: {
      summary: 'Help a new member check in at least 3 times in their first 30 days',
      completionType: 'composite',
      signals: [
        { type: 'checkin_count_3', weight: 100, completesGoal: true, verificationWindow: 30 },
        { type: 'checkin', weight: 33, completesGoal: false, verificationWindow: 30 },
      ],
      judgmentCriteria: 'The member is engaged and forming a habit. 3+ checkins is the signal. 1-2 checkins is progress. 0 checkins after 14 days is concerning.',
      outcomes: [
        { code: 'habit_formed', label: 'Habit Forming', type: 'positive', description: '3+ checkins in first 30 days', attributeRevenue: true, revenueMultiplier: 1.0 },
        { code: 'some_engagement', label: 'Some Engagement', type: 'neutral', description: '1-2 checkins, still building habit', attributeRevenue: false },
        { code: 'no_show', label: 'No-Show', type: 'negative', description: '0 checkins after 14+ days', attributeRevenue: false },
        { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'No reply to onboarding messages', attributeRevenue: false },
      ],
    },
    priority: 'medium',
    budget: { maxMessages: 4, maxDays: 30, maxTurns: 6 },
    followUp: CADENCES.slow_burn,
    autoThreshold: 85,
    escalationTriggers: [],
    skillFile: 'lib/task-skills/onboarding.md',
    outcomeSignals: ['checkin_count_3', 'reply_positive'],
  },

  // ── Staff to-do example ───────────────────────────────────────────────

  staff_call_member: {
    type: 'staff_call_member',
    label: 'Call Member',
    description: 'A human at the gym needs to call this member',
    category: 'staff_todo',
    assignmentType: 'owner',
    agent: 'gm',
    goal: {
      summary: 'Have a personal phone conversation with this member',
      completionType: 'human_confirms',
      outcomes: [
        { code: 'completed', label: 'Call Made', type: 'positive', description: 'Staff called the member', attributeRevenue: false },
        { code: 'member_unreachable', label: 'Unreachable', type: 'neutral', description: 'Tried calling, no answer', attributeRevenue: false },
        { code: 'skipped', label: 'Skipped', type: 'neutral', description: 'Owner decided not to call', attributeRevenue: false },
      ],
    },
    priority: 'high',
    budget: { maxMessages: 0, maxDays: 3, maxTurns: 0 },
    followUp: { intervals: [1, 2], toneProgression: ['reminder', 'urgent_reminder'], onExhaustion: 'escalate' as const },
    autoThreshold: 0,
    escalationTriggers: ['always'],
    skillFile: 'lib/task-skills/staff-call-member.md',
    outcomeSignals: ['checkin'],
  },

  // ── Research example ──────────────────────────────────────────────────

  monthly_churn_analysis: {
    type: 'monthly_churn_analysis',
    label: 'Monthly Churn Analysis',
    description: 'Analyze member data and produce a churn risk report',
    category: 'research',
    assignmentType: 'agent',
    agent: 'gm',
    goal: {
      summary: 'Produce a structured churn analysis report for the gym',
      completionType: 'deliverable',
      deliverableSpec: 'A report containing: total members, at-risk count, churn rate trend, top risk factors, recommended actions. Structured as markdown with a data summary.',
      outcomes: [
        { code: 'report_produced', label: 'Report Produced', type: 'positive', description: 'Analysis complete, report delivered', attributeRevenue: false },
        { code: 'insufficient_data', label: 'Insufficient Data', type: 'neutral', description: 'Not enough data to produce meaningful analysis', attributeRevenue: false },
      ],
    },
    priority: 'low',
    budget: { maxMessages: 0, maxDays: 1, maxTurns: 5 },
    followUp: CADENCES.single_shot,
    autoThreshold: 95,
    escalationTriggers: [],
    skillFile: 'lib/task-skills/monthly-churn-analysis.md',
    outcomeSignals: [],
    deliverableType: 'report',
  },

  // ── Ad-hoc (catch-all) ────────────────────────────────────────────────

  ad_hoc: {
    type: 'ad_hoc',
    label: 'Custom Task',
    description: 'A custom task created by the owner or agent for a specific purpose',
    category: 'communication',
    assignmentType: 'agent',
    agent: 'gm',
    goal: {
      summary: 'Accomplish the specific goal described by the owner',
      completionType: 'judgment',
      judgmentCriteria: 'The owner\'s stated goal has been achieved or the member has responded in a way that resolves the situation.',
      outcomes: [
        { code: 'resolved', label: 'Resolved', type: 'positive', description: 'Goal achieved', attributeRevenue: false },
        { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'No reply', attributeRevenue: false },
        { code: 'owner_handled', label: 'Owner Handled', type: 'positive', description: 'Owner took over and handled it', attributeRevenue: false },
      ],
    },
    priority: 'medium',
    budget: { maxMessages: 3, maxDays: 14, maxTurns: 6 },
    followUp: CADENCES.standard,
    autoThreshold: 0,
    escalationTriggers: ['always'],
    skillFile: 'lib/task-skills/ad-hoc.md',
    outcomeSignals: [],
  },
}

/**
 * Get the definition for a task type.
 * Falls back to ad_hoc for unknown types — safe default (always requires review).
 */
export function getTaskTypeDef(taskType: string): TaskTypeDef {
  return TASK_TYPES[taskType] ?? TASK_TYPES.ad_hoc
}
```

---

## 6. Execution Pipeline

### Overview

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────────┐
│  TRIGGERS    │───►│  TASK GATE   │───►│  EXECUTOR    │───►│  CONVERSATION │
│              │    │              │    │              │    │  LOOP         │
│ cron         │    │ confidence?  │    │ send message │    │               │
│ webhook      │    │ escalation?  │    │ via command  │    │ reply → eval  │
│ manual       │    │ gym mode?    │    │ bus          │    │ → reply/close │
│ gm chat      │    │              │    │              │    │ → escalate    │
└─────────────┘    └──────────────┘    └──────────────┘    └───────────────┘
       │                  │                    │                    │
       │                  │                    │                    │
       ▼                  ▼                    ▼                    ▼
  trigger_type      pending_review         executing            waiting
  trigger_event_id  OR ready               → waiting            → executing
                                                                → completed
                                                                → escalated
                                                                → cancelled
```

### 6.1 Task Creation (unified entry point)

**All task creation goes through one function.** No more separate paths.

```typescript
// lib/tasks/create-task.ts

interface CreateTaskInput {
  accountId: string
  taskType: string                // maps to TASK_TYPES registry
  triggerType: 'cron_analysis' | 'webhook' | 'manual' | 'gm_chat'
  triggerEventId?: string
  parentTaskId?: string           // for batch grouping

  // Member context
  memberEmail?: string
  memberName?: string
  memberId?: string

  // AI-provided
  goal: string
  confidence?: number             // 0-100
  draftMessage?: string
  messageSubject?: string

  // Override defaults from task type def (optional)
  priority?: Priority
  context?: Record<string, unknown>
}

async function createTask(input: CreateTaskInput): Promise<AgentTask> {
  const typeDef = getTaskTypeDef(input.taskType)
  const gym = await getAccount(input.accountId)

  // ── Step 1: Deduplication ──
  // Don't create a duplicate task for the same member + type if one is already active
  if (input.memberEmail) {
    const existing = await findActiveTask(input.accountId, input.memberEmail, input.taskType)
    if (existing) {
      // Update context with new data, don't create duplicate
      await updateTaskContext(existing.id, input.context)
      return existing
    }
  }

  // ── Step 2: Determine initial status via confidence gate ──
  const status = determineInitialStatus(gym, typeDef, input.confidence ?? 0, input.context)

  // ── Step 3: Calculate budget ──
  const budgetExpiresAt = new Date()
  budgetExpiresAt.setDate(budgetExpiresAt.getDate() + typeDef.budget.maxDays)

  // ── Step 4: Insert ──
  const task = await supabaseAdmin
    .from('agent_tasks')
    .insert({
      account_id: input.accountId,
      assigned_agent: typeDef.agent,
      task_type: input.taskType,
      member_email: input.memberEmail,
      member_name: input.memberName,
      member_id: input.memberId,
      goal: input.goal,
      status,
      priority: input.priority ?? typeDef.priority,
      confidence: input.confidence,
      requires_approval: status === 'pending_review',

      // Budget
      budget_messages_max: typeDef.budget.maxMessages,
      budget_messages_used: 0,
      budget_turns_max: typeDef.budget.maxTurns,
      budget_turns_used: 0,
      budget_expires_at: budgetExpiresAt.toISOString(),

      // Provenance
      trigger_type: input.triggerType,
      trigger_event_id: input.triggerEventId,
      parent_task_id: input.parentTaskId,

      // Context (everything else — type-specific data)
      context: {
        ...input.context,
        draftMessage: input.draftMessage,
        messageSubject: input.messageSubject,
        taskTypeConfig: typeDef,  // snapshot of config at creation time
      },
    })
    .select()
    .single()

  return task.data!
}
```

### 6.2 The Confidence Gate

```typescript
function determineInitialStatus(
  gym: { execution_mode: string },
  typeDef: TaskTypeDef,
  confidence: number,
  context?: Record<string, unknown>,
): 'pending_review' | 'ready' {
  // Manual mode: everything goes to review
  if (gym.execution_mode === 'manual') return 'pending_review'

  // Check escalation triggers
  const triggers = typeDef.escalationTriggers
  if (triggers.includes('always')) return 'pending_review'

  for (const trigger of triggers) {
    switch (trigger) {
      case 'member_tenure_over_1_year':
        if ((context?.memberTenureDays as number) > 365) return 'pending_review'
        break
      case 'member_tenure_over_2_years':
        if ((context?.memberTenureDays as number) > 730) return 'pending_review'
        break
      case 'monthly_value_over_200':
        if ((context?.monthlyValue as number) > 200) return 'pending_review'
        break
      case 'cancellation_reason_complaint':
        if ((context?.cancellationReason as string)?.includes('complaint')) return 'pending_review'
        break
      case 'cancellation_reason_billing':
        if ((context?.cancellationReason as string)?.includes('billing')) return 'pending_review'
        break
    }
  }

  // Confidence gate: must exceed task type threshold
  if (confidence < typeDef.autoThreshold) return 'pending_review'

  // All gates passed → auto-execute
  return 'ready'
}
```

### 6.3 Task Executor (cron, every 60s)

```typescript
// /api/cron/task-executor

async function executeReadyTasks() {
  // Phase 1: Pick up ready tasks
  const { data: readyTasks } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('status', 'ready')
    .order('priority_sort')  // critical first
    .limit(20)

  for (const task of readyTasks ?? []) {
    await executeTask(task)
  }
}

async function executeTask(task: AgentTask) {
  const typeDef = getTaskTypeDef(task.task_type)

  // ── Safety check: member rate limit ──
  if (task.member_email) {
    const recentCount = await countRecentMessages(task.member_email, 7)  // last 7 days
    const gym = await getAccount(task.account_id)
    if (recentCount >= (gym.member_weekly_limit ?? 3)) {
      // Don't send. Schedule retry for tomorrow.
      await updateTask(task.id, {
        status: 'waiting',
        next_action_at: tomorrow(),
        last_activity_at: now(),
      })
      await appendConversation(task.id, {
        role: 'system',
        content: `Skipped: member has received ${recentCount} messages this week (limit: ${gym.member_weekly_limit}).`,
      })
      return
    }
  }

  // ── Safety check: daily gym send limit ──
  const dailySent = await countGymMessagesToday(task.account_id)
  const gym = await getAccount(task.account_id)
  if (dailySent >= (gym.daily_send_limit ?? 15)) {
    // Queue for tomorrow
    await updateTask(task.id, { next_action_at: tomorrow() })
    return
  }

  // ── Execute: send first message ──
  const draftMessage = task.context?.draftMessage
  const subject = task.context?.messageSubject ?? `Message from ${gym.account_name}`

  if (!draftMessage || !task.member_email) {
    // Can't execute without a message/email — escalate
    await transitionTask(task.id, 'escalated', {
      reason: 'Missing draft message or member email',
    })
    return
  }

  // Issue SendEmail command via command bus
  await commandBus.issue('SendEmail', {
    recipientEmail: task.member_email,
    recipientName: task.member_name,
    subject,
    body: draftMessage,
    taskId: task.id,
    accountId: task.account_id,
    sentByAgent: task.assigned_agent,
  })

  // Update task state — schedule next follow-up per cadence
  const typeDef = getTaskTypeDef(task.task_type)
  const touchIndex = task.followup_touch_index ?? 0
  const nextInterval = typeDef.followUp.intervals[touchIndex]  // days until next touch
  const nextActionAt = nextInterval != null
    ? addDays(now(), nextInterval)
    : null  // no more follow-ups scheduled

  await transitionTask(task.id, 'waiting', {
    execution_started_at: task.execution_started_at ?? now(),
    budget_messages_used: task.budget_messages_used + 1,
    followup_touch_index: touchIndex + 1,
    next_action_at: nextActionAt,
  })

  // Log to conversation
  await appendConversation(task.id, {
    role: 'agent',
    content: draftMessage,
    agentName: task.assigned_agent,
  })
}
```

### 6.4 Task Ticker (cron, every 60s — second phase)

```typescript
async function tickWaitingTasks() {
  const now = new Date()

  // ── Phase 1: Budget timeout — auto-close expired tasks ──
  const { data: expired } = await supabaseAdmin
    .from('agent_tasks')
    .select('id')
    .in('status', ['waiting', 'executing', 'ready'])
    .lt('budget_expires_at', now.toISOString())

  for (const task of expired ?? []) {
    await transitionTask(task.id, 'cancelled', {
      outcome: 'unresponsive',
      outcome_reason: 'budget_time_expired',
    })
  }

  // ── Phase 2: Follow-up — tasks with next_action_at in the past ──
  const { data: followUps } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('status', 'waiting')
    .lt('next_action_at', now.toISOString())
    .not('next_action_at', 'is', null)
    .limit(20)

  for (const task of followUps ?? []) {
    const typeDef = getTaskTypeDef(task.task_type)
    const cadence = typeDef.followUp
    const touchIndex = task.followup_touch_index ?? 0

    // Check message budget
    if (task.budget_messages_used >= task.budget_messages_max) {
      await handleCadenceExhaustion(task, cadence, 'budget_messages_exhausted')
      continue
    }

    // Check turn budget
    if (task.budget_turns_used >= task.budget_turns_max) {
      await transitionTask(task.id, 'escalated', {
        outcome_reason: 'too_many_turns_without_resolution',
      })
      continue
    }

    // Check if we've used all follow-up touches
    if (touchIndex >= cadence.intervals.length) {
      await handleCadenceExhaustion(task, cadence, 'all_followup_touches_used')
      continue
    }

    // Draft follow-up via AI, with tone hint from cadence
    await executeFollowUp(task, {
      touchIndex,
      toneHint: cadence.toneProgression[touchIndex] ?? 'neutral',
      touchesRemaining: cadence.intervals.length - touchIndex,
    })
  }

  // ── Phase 3: Waiting tasks with no next_action_at and no more touches ──
  // These are tasks where next_action_at is null (all touches used)
  // but the task hasn't been transitioned yet. Handle via cadence exhaustion.
  const { data: exhausted } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('status', 'waiting')
    .is('next_action_at', null)
    .limit(20)

  for (const task of exhausted ?? []) {
    const typeDef = getTaskTypeDef(task.task_type)
    await handleCadenceExhaustion(task, typeDef.followUp, 'no_more_touches')
  }

  // ── Phase 4: Dormant tasks — periodic outcome checks ──
  const { data: dormantDue } = await supabaseAdmin
    .from('agent_tasks')
    .select('*')
    .eq('status', 'dormant')
    .lt('dormant_check_at', now.toISOString())
    .limit(20)

  for (const task of dormantDue ?? []) {
    await tickDormantTask(task)
  }

  // ── Phase 5: Dormant expiry — hard deadline for dormant tasks ──
  const { data: dormantExpired } = await supabaseAdmin
    .from('agent_tasks')
    .select('id')
    .eq('status', 'dormant')
    .lt('dormant_expires_at', now.toISOString())

  for (const task of dormantExpired ?? []) {
    await transitionTask(task.id, 'cancelled', {
      outcome: 'unresponsive',
      outcome_reason: 'dormant_window_expired',
    })
  }
}

/**
 * Handle what happens when a task runs out of follow-up touches.
 * The cadence's onExhaustion determines the outcome:
 * - 'cancel': close it, we tried our best
 * - 'escalate': surface to the owner for a decision
 * - 'dormant': park it and keep watching for outcome signals
 */
async function handleCadenceExhaustion(
  task: AgentTask,
  cadence: FollowUpCadence,
  reason: string,
) {
  switch (cadence.onExhaustion) {
    case 'cancel':
      await transitionTask(task.id, 'cancelled', {
        outcome: 'unresponsive',
        outcome_reason: reason,
      })
      break

    case 'escalate':
      await transitionTask(task.id, 'escalated', {
        outcome_reason: `${reason} — cadence requires owner review before closing`,
      })
      break

    case 'dormant': {
      const dormantCheckDays = cadence.dormantCheckDays ?? 7
      const dormantMaxDays = cadence.dormantMaxDays ?? 60

      await transitionTask(task.id, 'dormant', {
        dormant_at: new Date().toISOString(),
        dormant_check_at: addDays(new Date(), dormantCheckDays).toISOString(),
        dormant_expires_at: addDays(new Date(), dormantMaxDays).toISOString(),
      })

      await appendConversation(task.id, {
        role: 'system',
        content: `All follow-up touches used. Task is now dormant — monitoring for outcome signals (checkin, reply, etc.) for up to ${dormantMaxDays} days. No more outbound messages will be sent.`,
      })
      break
    }
  }
}

/**
 * Check a dormant task for outcome signals. If found, complete it.
 * If not, schedule the next check. No messages are sent.
 */
async function tickDormantTask(task: AgentTask) {
  const typeDef = getTaskTypeDef(task.task_type)

  // Check each outcome signal for this task type
  for (const signal of typeDef.outcomeSignals) {
    const checker = OUTCOME_CHECKERS[signal]
    if (!checker) continue

    const result = await checker(task)
    if (result) {
      await transitionTask(task.id, 'completed', {
        outcome: result.outcome,
        outcome_reason: `${result.reason} (detected during dormant monitoring)`,
        attributed_value: result.value,
      })
      return  // done — signal found
    }
  }

  // No signal found. Schedule next check.
  const cadence = typeDef.followUp
  const nextCheck = addDays(new Date(), cadence.dormantCheckDays ?? 7)

  await supabaseAdmin
    .from('agent_tasks')
    .update({
      dormant_check_at: nextCheck.toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', task.id)

  await appendConversation(task.id, {
    role: 'system',
    content: `Dormant check: no outcome signal detected. Next check in ${cadence.dormantCheckDays ?? 7} days.`,
  })
}
```

**The dormant state's key properties:**

1. **No outbound messages** — the system never emails a dormant member. It's purely passive.
2. **Watches for outcome signals** — checkins, payments, replies, reactivations. Same signals as the attribution cron in §9.
3. **Wakes up on member reply** — if a member replies to an old email (they were on vacation), the inbound webhook routes the reply to the task. The task transitions `dormant → executing` and the conversation loop handles it normally.
4. **Has a hard deadline** — `dormant_expires_at` prevents zombie tasks. Default: 60-90 days depending on task type. After that, the task closes as `unresponsive`.
5. **Cheap to maintain** — a dormant check is one DB query per outcome signal. No AI calls. Hundreds of dormant tasks cost nearly nothing.

### 6.5 Conversation Loop (on reply received)

```typescript
// Called by inbound email webhook when member replies

async function handleMemberReply(taskId: string, replyContent: string) {
  const task = await getTask(taskId)
  if (!task) return

  // ── Handle reply to a dormant or cancelled task ──
  // Member replies to an old email (e.g., back from vacation).
  // Wake it up — a human replying is always worth responding to.
  if (task.status === 'dormant') {
    await transitionTask(taskId, 'executing', {
      reason: 'member_replied_while_dormant',
    })
    await appendConversation(taskId, {
      role: 'system',
      content: 'Task reactivated — member replied while task was dormant.',
    })
    // Continue to handle the reply normally below
  }

  if (task.status === 'cancelled') {
    // Rare: member replies after task was cancelled. Don't auto-reopen.
    // Log it and notify the owner so they can decide.
    await appendConversation(taskId, {
      role: 'member',
      content: replyContent,
    })
    await appendConversation(taskId, {
      role: 'system',
      content: 'Member replied after task was cancelled. Notifying owner.',
    })
    await notifyOwner(task.account_id, 'late_reply', {
      taskId,
      memberName: task.member_name,
      replyPreview: replyContent.slice(0, 200),
    })
    return
  }

  // ── Budget check: turns ──
  if (task.budget_turns_used >= task.budget_turns_max) {
    await transitionTask(taskId, 'escalated', {
      outcome_reason: 'turn_budget_exhausted_on_reply',
    })
    return
  }

  // Log the reply
  await appendConversation(taskId, {
    role: 'member',
    content: replyContent,
  })

  // ── AI evaluation ──
  const history = await getConversationHistory(taskId)
  const typeDef = getTaskTypeDef(task.task_type)

  const evaluation = await claudeEvaluate({
    systemPrompt: typeDef.systemPrompt,
    conversationHistory: history,
    budgetRemaining: {
      messages: task.budget_messages_max - task.budget_messages_used,
      turns: task.budget_turns_max - task.budget_turns_used,
      daysLeft: daysBetween(new Date(), new Date(task.budget_expires_at)),
    },
  })

  // Log evaluation
  await appendConversation(taskId, {
    role: 'system',
    content: evaluation.reasoning,
    evaluation,
  })

  // Increment turn counter
  await incrementBudget(taskId, 'turns')

  // ── Act on evaluation ──
  switch (evaluation.action) {
    case 'reply':
      // Budget check before sending
      if (task.budget_messages_used >= task.budget_messages_max) {
        await transitionTask(taskId, 'escalated', {
          outcome_reason: 'wants_to_reply_but_message_budget_exhausted',
        })
        break
      }

      // Confidence check on the reply itself
      if (evaluation.confidence < 50) {
        // AI isn't confident in its own reply — escalate
        await transitionTask(taskId, 'escalated', {
          outcome_reason: 'low_confidence_on_reply',
          draftReply: evaluation.reply,  // save for owner to review/edit
        })
        break
      }

      await sendReply(task, evaluation.reply)
      break

    case 'close':
      await transitionTask(taskId, 'completed', {
        outcome: evaluation.outcome ?? 'engaged',
        outcome_reason: evaluation.scoreReason,
        outcome_score: evaluation.outcomeScore,
      })
      break

    case 'escalate':
      await transitionTask(taskId, 'escalated', {
        outcome_reason: evaluation.reasoning,
      })
      break

    case 'wait':
      // Update next_action_at for follow-up, stay in waiting
      await updateTask(taskId, {
        next_action_at: addDays(new Date(), evaluation.waitDays ?? 3),
        last_activity_at: new Date().toISOString(),
      })
      break
  }
}
```

---

## 7. Safety Rails (The "Don't Go Rogue" System)

### 7.1 Budget Enforcement

Every task has three budgets, all enforced BEFORE any action:

| Budget | Default | What it prevents |
|--------|---------|------------------|
| `budget_messages_max` | 3 | Flooding a member with emails |
| `budget_turns_max` | 6 | Runaway AI reasoning loops |
| `budget_expires_at` | +14 days | Zombie tasks that never close |

When ANY budget is exhausted:
- If messages or time exhausted → `cancelled` with `outcome = 'unresponsive'`
- If turns exhausted → `escalated` (something is wrong if AI needs 6+ turns)

### 7.2 Member Rate Limit

```sql
-- Before ANY outbound message, check:
SELECT COUNT(*) FROM outbound_messages
WHERE recipient_email = $1
  AND created_at > NOW() - INTERVAL '7 days'
  AND status IN ('sent', 'delivered')
```

Default limit: **3 messages per member per week** (configurable per gym).

If exceeded: task pauses (status stays `waiting`, `next_action_at` set to tomorrow). Never sends.

### 7.3 Daily Gym Send Limit

Default: **15 messages per gym per day** (configurable).

This prevents a bad analysis run from flooding all members at once.

### 7.4 Confidence Gating at Every Step

Confidence is checked at **three points**, not just task creation:

1. **Task creation**: Determines `pending_review` vs `ready` (section 6.2)
2. **Reply evaluation**: If AI confidence < 50 on its own reply, escalate instead of sending
3. **Follow-up drafting**: Same confidence check before sending follow-up messages

### 7.5 Anomaly Detection

The task ticker checks for anomalies:

- **5+ conversation turns with no resolution** → auto-escalate
- **Member sent 3+ replies but task still active** → auto-escalate (possible loop)
- **Task has been `executing` for > 5 minutes** → something stuck, reset to `waiting`

### 7.6 Kill Switch

Setting `gym.execution_mode = 'manual'` immediately stops all auto-execution. All future tasks go to `pending_review`. Already-`waiting` tasks continue their conversation loops (since those are reply-driven, not auto-initiated) but no NEW auto-sends happen.

### 7.7 Task Deduplication

Before creating a task, check for an existing active task for the same member + type:

```sql
SELECT id FROM agent_tasks
WHERE account_id = $1
  AND member_email = $2
  AND task_type = $3
  AND status NOT IN ('completed', 'cancelled')
LIMIT 1
```

If found: update the existing task's context (merge new data), don't create a duplicate.

### 7.8 Subtask Spawning Limits

**The runaway risk:** An agent creates a subtask. Subtask completes. Agent evaluates, decides to create another subtask. Repeat forever — the agent never concludes the parent goal is met (or gives up), and keeps spawning steps.

**Circuit breakers:**

```typescript
const SUBTASK_LIMITS = {
  maxSubtasksPerParent: 8,       // hard cap — no parent can have more than 8 children
  maxSubtaskDepth: 2,            // subtasks cannot create their own subtasks (depth 1 = child, depth 2 = grandchild, that's it)
  maxSubtasksPerEvaluation: 2,   // agent can create at most 2 subtasks per planning step
}
```

Enforced in `createTask()`:

```typescript
async function createTask(input: CreateTaskInput): Promise<AgentTask> {
  // ... existing logic ...

  // ── Subtask circuit breakers ──
  if (input.parentTaskId) {
    // Check depth: walk up parent_task_id chain
    const depth = await getTaskDepth(input.parentTaskId)
    if (depth >= SUBTASK_LIMITS.maxSubtaskDepth) {
      throw new Error(`Subtask depth limit reached (max ${SUBTASK_LIMITS.maxSubtaskDepth}). Cannot nest deeper.`)
    }

    // Check sibling count
    const siblingCount = await countSubtasks(input.parentTaskId)
    if (siblingCount >= SUBTASK_LIMITS.maxSubtasksPerParent) {
      // Don't throw — escalate the parent instead
      await transitionTask(input.parentTaskId, 'escalated', {
        reason: `Subtask limit reached (${SUBTASK_LIMITS.maxSubtasksPerParent}). Agent created too many steps without completing the goal.`,
      })
      return null  // caller checks for null
    }
  }

  // ... rest of creation ...
}

async function getTaskDepth(taskId: string): Promise<number> {
  let depth = 0
  let currentId: string | null = taskId
  while (currentId) {
    const task = await getTask(currentId)
    currentId = task?.parent_task_id ?? null
    depth++
    if (depth > 10) break  // paranoia cap
  }
  return depth
}
```

### 7.9 Task Creation Flood Protection

**The runaway risk:** A cron analysis run finds 500 at-risk members and tries to create 500 tasks in one invocation. Or a burst of PushPress webhooks creates hundreds of tasks simultaneously.

**Circuit breakers:**

```typescript
const FLOOD_LIMITS = {
  maxTasksPerCronRun: 25,           // analysis cron creates at most 25 tasks per invocation
  maxTasksPerGymPerDay: 50,         // no gym can have more than 50 tasks created in a single day
  maxActiveTasksPerGym: 100,        // if a gym has 100+ non-terminal tasks, stop creating new ones
  maxTasksPerWebhookBurst: 5,       // a single webhook event can create at most 5 tasks
}
```

Enforced at the system level, not per-task:

```typescript
// In the analysis cron
async function runAnalysis(accountId: string) {
  const insights = await analyzeMembers(accountId)  // might return 200 insights

  // Sort by priority, take top N
  const toCreate = insights
    .sort((a, b) => prioritySort(b) - prioritySort(a))
    .slice(0, FLOOD_LIMITS.maxTasksPerCronRun)

  // Additional check: active task count
  const activeCount = await countActiveTasks(accountId)
  if (activeCount >= FLOOD_LIMITS.maxActiveTasksPerGym) {
    await logEvent(accountId, 'flood_protection', {
      message: `Gym has ${activeCount} active tasks. Skipping new task creation.`,
      skippedInsights: insights.length,
    })
    return
  }

  // Daily creation check
  const todayCount = await countTasksCreatedToday(accountId)
  const remaining = FLOOD_LIMITS.maxTasksPerGymPerDay - todayCount
  if (remaining <= 0) {
    await logEvent(accountId, 'flood_protection', {
      message: `Daily task creation limit reached (${FLOOD_LIMITS.maxTasksPerGymPerDay}).`,
    })
    return
  }

  for (const insight of toCreate.slice(0, remaining)) {
    await createTask({ accountId, ...insight })
  }
}
```

### 7.10 Cron Overlap Protection

**The runaway risk:** The task-executor cron runs every 60 seconds. If one invocation takes longer than 60 seconds (slow AI call, DB timeout), the next invocation starts and both process the same tasks — resulting in double-sends, duplicate subtasks, or race conditions.

**Circuit breaker:** Advisory lock at the start of every cron job.

```typescript
async function withCronLock(lockName: string, fn: () => Promise<void>) {
  // Use Supabase/Postgres advisory lock
  const lockId = hashToInt(lockName)  // deterministic int from name
  const { data } = await supabaseAdmin.rpc('pg_try_advisory_lock', { lock_id: lockId })

  if (!data) {
    console.log(`[cron] ${lockName}: skipped — previous run still active`)
    return
  }

  try {
    await fn()
  } finally {
    await supabaseAdmin.rpc('pg_advisory_unlock', { lock_id: lockId })
  }
}

// Usage:
export async function POST() {
  await withCronLock('task-executor', async () => {
    await executeReadyTasks()
    await tickWaitingTasks()
  })
}
```

Additionally, the task executor uses `SELECT ... FOR UPDATE SKIP LOCKED` when picking up tasks, so even without the advisory lock, two concurrent runs won't grab the same task.

### 7.11 Retry Storm Prevention

**The runaway risk:** An action fails (PushPress API down, Resend rate-limited), retries immediately, fails again, retries, burns through resources in a tight loop.

**Circuit breaker:** Exponential backoff with a hard retry cap.

```typescript
const RETRY_POLICY = {
  maxRetries: 3,
  backoffMs: [60_000, 300_000, 3_600_000],  // 1 min, 5 min, 1 hour
  deadLetterAfterRetries: true,              // after 3 failures, stop trying
}
```

After `maxRetries` failures:
- If the action has `externalSideEffect: true` → escalate the task (human needs to know)
- If the action is internal (research, draft) → cancel the subtask and let the parent agent decide what to do
- The failed command goes to a dead letter queue (existing `command_bus` table with `status: 'dead_letter'`)

Never retry synchronously. Always schedule the retry via `next_action_at` — the next cron tick picks it up.

### 7.12 AI Cost Circuit Breaker

**The runaway risk:** The system makes hundreds of Claude API calls per cron tick — evaluating tasks, drafting messages, planning subtasks. Costs spiral without anyone noticing.

**Circuit breaker:** Track AI calls per gym per day. Hard-stop at a configurable ceiling.

```typescript
const AI_COST_LIMITS = {
  maxAiCallsPerGymPerDay: 200,     // ~$2-5 depending on model mix
  maxAiCallsPerTaskLifetime: 20,   // no single task can make more than 20 AI calls total
  warnThresholdPct: 80,            // notify owner at 80% of daily limit
}
```

Enforced in the AI call wrapper:

```typescript
async function callClaude(accountId: string, taskId: string, params: ClaudeParams) {
  // Per-gym daily check
  const dailyCalls = await countAiCallsToday(accountId)
  if (dailyCalls >= AI_COST_LIMITS.maxAiCallsPerGymPerDay) {
    throw new AiLimitError(`Gym ${accountId} hit daily AI call limit (${dailyCalls})`)
  }

  // Per-task lifetime check
  if (taskId) {
    const taskCalls = await countAiCallsForTask(taskId)
    if (taskCalls >= AI_COST_LIMITS.maxAiCallsPerTaskLifetime) {
      throw new AiLimitError(`Task ${taskId} hit AI call limit (${taskCalls})`)
    }
  }

  // Warn at threshold
  if (dailyCalls >= AI_COST_LIMITS.maxAiCallsPerGymPerDay * AI_COST_LIMITS.warnThresholdPct / 100) {
    await notifyOwner(accountId, 'ai_cost_warning', {
      message: `AI usage at ${Math.round(dailyCalls / AI_COST_LIMITS.maxAiCallsPerGymPerDay * 100)}% of daily limit`,
    })
  }

  // Track the call
  await logAiCall(accountId, taskId, params.model, params.inputTokens, params.outputTokens)

  return await anthropic.messages.create(params)
}
```

When the limit is hit mid-task: the task moves to `waiting` with `next_action_at` set to tomorrow. It resumes when the daily budget resets.

### 7.13 Cross-Task Amplification Prevention

**The runaway risk:** Task A's agent, during conversation, decides to create Task B (e.g., "this member also needs a payment follow-up"). Task B's agent decides to create Task C. Task C creates Task D. The system generates work for itself without bound.

**Circuit breaker:** Tasks created by agents (not by cron or webhooks) are flagged and capped.

```typescript
const AMPLIFICATION_LIMITS = {
  maxAgentCreatedTasksPerGymPerDay: 10,  // agents can create at most 10 tasks per day
  agentCreatedTasksAlwaysNeedReview: true, // never auto-execute an agent-spawned task
}
```

Enforced in `createTask()`:

```typescript
if (input.triggerType === 'agent_spawned') {
  const agentCreatedToday = await countAgentCreatedTasksToday(input.accountId)
  if (agentCreatedToday >= AMPLIFICATION_LIMITS.maxAgentCreatedTasksPerGymPerDay) {
    // Log the suppressed task, don't create it
    await logEvent(input.accountId, 'amplification_suppressed', {
      taskType: input.taskType,
      memberEmail: input.memberEmail,
      reason: 'daily agent-created task limit reached',
    })
    return null
  }

  // Agent-created tasks ALWAYS go to pending_review, regardless of confidence
  // This ensures a human sees every task the AI decided to create on its own
  if (AMPLIFICATION_LIMITS.agentCreatedTasksAlwaysNeedReview) {
    forceStatus = 'pending_review'
  }
}
```

This is critical: **agents can suggest work, but they can't silently generate an unbounded workload.** Every agent-spawned task surfaces in the owner's review queue.

### 7.14 Global Emergency Stop

**The runaway risk:** Something we didn't anticipate. The system is doing something harmful and we need to stop everything across all gyms, immediately.

**Circuit breaker:** A global flag checked at the top of every cron job and every action executor.

```typescript
// Stored in Supabase `system_config` table or env var
async function isSystemPaused(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('system_config')
    .select('value')
    .eq('key', 'global_pause')
    .single()
  return data?.value === 'true'
}

// Checked first in every cron and executor:
if (await isSystemPaused()) {
  console.log('[system] Global pause active. Skipping all execution.')
  return
}
```

Can be toggled from Supabase dashboard or via an admin API endpoint. Affects ALL gyms immediately.

### 7.15 Runaway Detection Summary

All limits in one place for easy tuning:

```typescript
// lib/safety-limits.ts — the complete set of circuit breakers

export const SAFETY_LIMITS = {
  // Per-task (from §7.1)
  task: {
    defaultMaxMessages: 3,
    defaultMaxTurns: 6,
    defaultMaxDays: 14,
  },

  // Per-member (from §7.2)
  member: {
    maxMessagesPerWeek: 3,
  },

  // Per-gym (from §7.3, §7.9, §7.12, §7.13)
  gym: {
    maxSendsPerDay: 15,
    maxTasksCreatedPerDay: 50,
    maxActiveTasksAtOnce: 100,
    maxAiCallsPerDay: 200,
    maxAgentSpawnedTasksPerDay: 10,
  },

  // Per-parent-task (from §7.8)
  subtasks: {
    maxPerParent: 8,
    maxDepth: 2,
    maxCreatedPerEvaluation: 2,
  },

  // Per-cron-run (from §7.9, §7.10)
  cron: {
    maxTasksCreatedPerRun: 25,
    maxTasksExecutedPerRun: 20,
    usesAdvisoryLock: true,
  },

  // Per-action (from §7.11)
  retry: {
    maxRetries: 3,
    backoffMs: [60_000, 300_000, 3_600_000],
  },

  // Per-webhook (from §7.9)
  webhook: {
    maxTasksPerEvent: 5,
  },

  // Global (from §7.14)
  system: {
    globalPauseKey: 'global_pause',
  },
}
```

**The principle: every loop in the system has a counter, every counter has a ceiling, and every ceiling is a constant in one file.** If something runs away, we change one number. If we need to debug, every limit violation is logged with context.

---

## 8. Conversation Model

Reuses the existing `task_conversations` table. The evaluation JSONB is extended:

```typescript
interface TaskEvaluation {
  reasoning: string        // 2-3 sentences on what the AI observed
  action: 'reply' | 'close' | 'escalate' | 'wait'
  reply?: string           // the drafted reply (if action = 'reply')
  confidence: number       // 0-100 on this specific decision
  outcomeScore?: number    // 0-100 estimated likelihood of achieving the goal
  outcome?: string         // if closing: engaged, churned, etc.
  scoreReason?: string     // why this outcome score
  waitDays?: number        // if action = 'wait': how many days until follow-up
  budgetRemaining: {       // snapshot for audit trail
    messages: number
    turns: number
    daysLeft: number
  }
}
```

The AI's system prompt includes budget awareness:

```
You have {messages} messages remaining, {turns} reasoning turns, and {daysLeft} days
before this task expires. Use them wisely. If you're running low and haven't achieved
the goal, consider escalating to the gym owner rather than burning your remaining budget
on a long shot.
```

---

## 9. Outcome Attribution

Extends the existing attribution cron. The key change: **attribution checks are driven by the task type's `outcomeSignals`**.

```typescript
const OUTCOME_CHECKERS: Record<string, (task: AgentTask) => Promise<OutcomeResult | null>> = {
  checkin: async (task) => {
    // Check PushPress for a checkin by this member since task started
    const checkins = await pushpress.getCheckins(task.member_id, { since: task.execution_started_at })
    if (checkins.length > 0) {
      return { outcome: 'engaged', reason: 'checkin_after_outreach', value: gym.avg_membership_price }
    }
    return null
  },

  reactivation: async (task) => {
    // Check if cancelled member's status changed back to active
    const member = await pushpress.getCustomer(task.member_id)
    if (member.status === 'active') {
      return { outcome: 'recovered', reason: 'membership_reactivated', value: gym.avg_membership_price * 3 }
    }
    return null
  },

  payment_succeeded: async (task) => {
    // Check if failed payment was retried successfully
    const payments = await pushpress.getPayments(task.member_id, { since: task.execution_started_at })
    if (payments.some(p => p.status === 'succeeded')) {
      return { outcome: 'recovered', reason: 'payment_recovered', value: payments[0].amount }
    }
    return null
  },

  reply_positive: async (task) => {
    // Already handled in conversation evaluation — if AI closed with 'engaged', that's attribution
    return null  // no additional check needed
  },
}
```

---

## 10. Cron Architecture

### Consolidated Schedule

| Cron | Frequency | What it does |
|------|-----------|-------------|
| `/api/cron/run-analysis` | Every 6h | GMAgent scans → creates tasks |
| `/api/cron/task-executor` | Every 60s | Execute `ready` tasks + tick `waiting` tasks + process command bus |
| `/api/cron/attribute-outcomes` | Every 1h | Check outcome signals for active tasks |
| `/api/cron/daily-digest` | Once daily (8am) | Owner email summary |

The existing `process-commands` cron is renamed/refactored to `task-executor`. It handles three phases:

1. **Command bus**: Process pending `SendEmail` (and future) commands with retry
2. **Ready tasks**: Pick up `ready` tasks and execute first action
3. **Waiting tasks**: Check for follow-ups due, timeouts, budget exhaustion

This consolidation means one cron job handles all task lifecycle operations, reducing Vercel Cron slots and making the system easier to reason about.

---

## 11. Transition Function (the single source of truth for state changes)

```typescript
// lib/tasks/transition.ts

/**
 * The ONLY way to change a task's status. Enforces valid transitions,
 * logs every change, and runs side effects.
 */
async function transitionTask(
  taskId: string,
  newStatus: TaskStatus,
  metadata?: {
    reason?: string
    outcome?: string
    outcome_reason?: string
    outcome_score?: number
    draftReply?: string
    [key: string]: unknown
  },
): Promise<void> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  // Validate transition
  const allowed = VALID_TRANSITIONS[task.status as TaskStatus]
  if (!allowed?.includes(newStatus)) {
    throw new Error(`Invalid transition: ${task.status} → ${newStatus}`)
  }

  // Build update
  const update: Record<string, unknown> = {
    status: newStatus,
    last_activity_at: new Date().toISOString(),
  }

  // Terminal states
  if (newStatus === 'completed' || newStatus === 'cancelled') {
    update.resolved_at = new Date().toISOString()
    if (metadata?.outcome) update.outcome = metadata.outcome
    if (metadata?.outcome_reason) update.outcome_reason = metadata.outcome_reason
    if (metadata?.outcome_score) update.outcome_score = metadata.outcome_score
  }

  // Approval
  if (newStatus === 'ready' && task.status === 'pending_review') {
    update.approved_at = new Date().toISOString()
    update.requires_approval = false
  }

  await supabaseAdmin
    .from('agent_tasks')
    .update(update)
    .eq('id', taskId)

  // Log the transition
  await appendConversation(taskId, {
    role: 'system',
    content: `Status: ${task.status} → ${newStatus}${metadata?.reason ? ` (${metadata.reason})` : ''}`,
  })
}
```

---

## 12. How New Task Types Are Added (The Extensibility Story)

Adding a new task type (e.g., "Reputation Agent — ask for Google review at milestone"):

### Step 1: Add to registry (1 minute)

```typescript
// In lib/task-types.ts, add:
milestone_review: {
  type: 'milestone_review',
  label: 'Milestone Review Request',
  agent: 'reputation',
  priority: 'low',
  budget: { maxMessages: 1, maxDays: 7, maxTurns: 2 },
  autoThreshold: 90,  // high bar — asking for reviews can annoy people
  escalationTriggers: [],
  systemPrompt: `A member just hit a milestone (10th visit, 1 year, etc). Draft a warm
    congratulations that naturally includes a request to leave a Google review...`,
  outcomeSignals: ['review_posted'],
},
```

### Step 2: Add a trigger (5 minutes)

In the webhook handler or cron analysis, add a condition:

```typescript
if (event.type === 'checkin.created') {
  const checkinCount = await getCheckinCount(member.id)
  if ([10, 25, 50, 100].includes(checkinCount)) {
    await createTask({
      accountId: gym.id,
      taskType: 'milestone_review',
      triggerType: 'webhook',
      memberEmail: member.email,
      memberName: member.name,
      goal: `Congratulate ${member.name} on visit #${checkinCount} and ask for a Google review`,
      confidence: 95,
    })
  }
}
```

### Step 3: There is no step 3.

The task flows through the same pipeline: confidence gate → execution → conversation → outcome. No new tables, no new crons, no new components. The ReviewQueue on the dashboard shows it automatically.

---

## 13. Key Design Decisions & Tradeoffs

### Decision: Budget as hard limits, not soft suggestions

**Chose**: Hard enforcement — the system physically cannot send a 4th email if `budget_messages_max = 3`.

**Tradeoff**: Some edge cases might benefit from one more message. But the alternative (soft limits the AI can override with reasoning) opens the door to runaway behavior. Hard limits are the correct default for a system sending real emails to real people.

### Decision: Confidence gating at reply-time, not just task creation

**Chose**: Check confidence at every outbound action (creation, reply, follow-up).

**Tradeoff**: More AI evaluations = slightly higher cost and latency. But this catches the case where the AI was confident at task creation but becomes confused during the conversation. A confused AI sending a bad reply is the #1 risk scenario.

### Decision: Single `transitionTask()` function for all state changes

**Chose**: All status changes go through one function that validates transitions and logs them.

**Tradeoff**: Slightly more verbose than `update().eq('id', taskId)`. But this prevents invalid transitions (e.g., `cancelled → executing`) and ensures every change is logged. Worth it for a system managing real customer communications.

### Decision: Task type definitions in code, not DB

**Chose**: `TASK_TYPES` is a TypeScript object, not a database table.

**Tradeoff**: Gym owners can't customize budgets per task type (yet). But: (a) premature customization is dangerous — owners could set bad limits, (b) code-based definitions are versioned, testable, and type-safe, (c) we can add a DB override layer later if needed.

### Decision: Deduplication prevents multiple active tasks per member+type

**Chose**: If a task already exists for Sarah + churn_risk, don't create another one.

**Tradeoff**: If the AI finds new context (her risk score increased), we update the existing task rather than creating a new one. This prevents the "5 tasks for one member" problem but means we need to handle context merging correctly.

### Decision: Escalation is the safe failure mode

**Chose**: When in doubt, escalate. Budget exhaustion with no resolution → escalate. Low confidence on a reply → escalate. Unknown error → escalate.

**Tradeoff**: In the worst case, the owner gets too many escalations. This is annoying but not harmful. The alternative (AI guesses and sends a bad message) is harmful. Annoying > harmful.

---

## 14. Subtask Model

Tasks in sections 1-13 are leaf tasks — single-goal, single-member, single-agent. But many real gym operations require **coordination across multiple actions**. A "recover failed payment" task might need to: check the payment processor, draft a message, update a PushPress tag, notify the coach, and follow up in 3 days. That's not one action — it's a plan.

### 14.1 Parent Tasks and Subtasks

A parent task represents a **goal**. Subtasks represent **steps** toward that goal.

```
Parent: "Win back Alex (cancelled yesterday)"
  ├── Subtask 1: research_member   [required]     — pull Alex's history, tenure, notes
  ├── Subtask 2: draft_outreach    [required]     — write a personal email
  ├── Subtask 3: send_email        [required]     — send the email to Alex
  ├── Subtask 4: tag_member        [optional]     — add "win_back_active" tag in PushPress
  └── Subtask 5: schedule_followup [required]     — if no reply in 3 days, draft follow-up
```

Schema (already in place from section 4):

```sql
parent_task_id UUID REFERENCES agent_tasks(id)
```

### 14.2 How Agents Decompose Goals Into Subtasks

The agent doesn't create all subtasks upfront. It **plans iteratively** — executing one step, observing the result, then deciding the next step. This prevents the "wrong plan, perfectly executed" problem.

```typescript
interface TaskPlan {
  nextStep: SubtaskDef        // what to do now
  remainingSteps: string[]    // rough outline of what comes after (for logging/UI only)
  reasoning: string           // why this step, why this order
}

interface SubtaskDef {
  taskType: string            // maps to TASK_TYPES or SUBTASK_TYPES registry
  actionType: ActionType      // what kind of work this is (see 15.1)
  goal: string                // specific goal for this step
  autoExecute: boolean        // can this run without human review?
  dependsOn?: string          // subtask ID that must complete first
  requirement: SubtaskRequirement  // how this subtask relates to parent completion (see §14.6)
  context: Record<string, unknown>
}

type SubtaskRequirement = 'required' | 'optional' | 'best_effort'
// required    — parent CANNOT complete until this subtask succeeds. Failure escalates the parent.
// optional    — parent CAN complete without this. Failure is logged but doesn't block.
// best_effort — like optional, but failure doesn't even get logged as a concern.
//               Used for nice-to-have enrichment (e.g., pull extra member stats).
```

The agent generates a `TaskPlan` when a parent task moves to `executing`. After each subtask completes, the agent is called again to evaluate progress and decide the next step (or mark the parent complete).

### 14.3 Subtask Execution Rules

1. **Subtasks inherit the parent's budget ceiling** — a parent with `budget_messages_max: 3` means ALL its subtasks combined can send at most 3 messages. The parent tracks the aggregate.

2. **Subtasks have their own mini-budgets** — each subtask gets a tight budget (e.g., 1 message, 2 turns, 1 day). This prevents any single step from consuming the whole parent budget.

3. **Subtasks can auto-execute IF**:
   - The parent was approved (or auto-approved)
   - The subtask's `actionType` is in the gym's auto-allowed list
   - The subtask's confidence meets the threshold
   - Communication subtasks (email, SMS) still go through all the same safety rails (rate limits, confidence gating)

4. **Subtask failure handling depends on `requirement`**:
   - `required` subtask fails → parent escalates with context about which step is blocked and why
   - `optional` subtask fails → logged as a note, parent continues to next step. Agent re-evaluates whether the parent goal can still be achieved without it.
   - `best_effort` subtask fails → silently skipped, parent continues. No impact on goal evaluation.

5. **Deferred subtasks** (like "follow up in 3 days") are created with `status: 'waiting'` and a `next_action_at` timestamp. The task ticker picks them up when the time comes.

### 14.4 Parent Task State Derived from Subtasks

The parent task's state is **derived from its children**, not tracked independently.

The derivation respects the `requirement` field — only `required` subtasks can block or escalate the parent. Optional and best-effort subtasks that fail are treated as resolved for the purpose of parent state derivation.

```typescript
function deriveParentStatus(subtasks: AgentTask[]): TaskStatus {
  const required = subtasks.filter(t => t.requirement === 'required')
  const blocking = subtasks.filter(t => t.requirement !== 'best_effort')  // required + optional

  // A required subtask escalated → parent must escalate (blocker)
  if (required.some(t => t.status === 'escalated')) return 'escalated'

  // An optional subtask escalated → doesn't block parent, but log it.
  // (optional escalations are treated as cancelled for derivation purposes)

  // Any subtask still actively running → parent is executing
  if (subtasks.some(t => ['executing', 'ready'].includes(t.status))) return 'executing'

  // Any required or optional subtask waiting → parent is waiting
  if (blocking.some(t => t.status === 'waiting')) return 'waiting'

  // Any subtask needs review → parent is pending_review
  if (subtasks.some(t => t.status === 'pending_review')) return 'pending_review'

  // All subtasks terminal (completed, cancelled, or failed-optional) → evaluate parent goal
  const allTerminal = subtasks.every(t =>
    ['completed', 'cancelled'].includes(t.status) ||
    (t.requirement !== 'required' && ['escalated', 'cancelled'].includes(t.status))
  )
  if (allTerminal) {
    return 'needs_evaluation'  // trigger agent to evaluate if parent goal was met
  }

  return 'executing'  // default: still working
}
```

The `needs_evaluation` pseudo-state triggers the agent to look at the results of all subtasks and decide: is the parent goal achieved? Should it create more subtasks? Should it escalate?

### 14.5 The Subtask Lifecycle

```
Parent created (pending_review or ready)
    │
    ▼
Agent plans first step → creates Subtask 1
    │
    ▼
Subtask 1 executes → completes (or fails/escalates)
    │
    ▼
Agent evaluates: "Step 1 done. Goal achieved? No → plan next step"
    │
    ▼
Agent creates Subtask 2 → executes → completes
    │
    ▼
Agent evaluates: "Step 2 done. Goal achieved? Yes → complete parent"
    OR: "Step 2 failed + required. Can I recover? No → escalate parent"
    OR: "Step 2 failed + optional. Goal still achievable? Yes → continue"
    OR: "Budget exhausted. Escalate with summary of what was accomplished."
```

Key principle: **the agent re-evaluates after every subtask**. It never blindly executes a 5-step plan. Each step is a chance to pivot, stop, or escalate.

### 14.6 Subtask Requirements: Blockers, Optional, and Best-Effort

Not all subtasks are equally important to the parent's goal. The `requirement` field controls how a subtask's outcome affects the parent:

| Requirement | Blocks parent? | On failure | On escalation | Example |
|-------------|---------------|------------|---------------|---------|
| `required` | **Yes** — parent cannot complete until this succeeds | Parent escalates | Parent escalates | Send the actual email, get member reply |
| `optional` | **No** — parent can complete without it | Logged, parent continues. Agent considers impact on goal. | Treated as cancelled for parent derivation | Pull extra member stats, add a PushPress tag |
| `best_effort` | **No** — parent ignores this entirely | Silently skipped | Silently skipped | Log analytics event, enrich member profile |

#### When to use each

**`required`** — The subtask IS the work. If the parent goal is "win back Alex" and the subtask is "send the outreach email", that's required. No email = no win-back attempt.

**`optional`** — The subtask improves the outcome but isn't essential. If the subtask is "tag member as win_back_active in PushPress" and the API is down, the outreach can still happen. The agent re-evaluates: "tagging failed, but the email was sent — goal is still on track."

**`best_effort`** — Nice-to-have enrichment that shouldn't create noise if it fails. If the subtask is "pull the member's class attendance histogram for the last 6 months" and PushPress returns a timeout, don't log an error or make the agent think about it. Just skip.

#### Dependency chains with mixed requirements

Subtasks can depend on other subtasks via `dependsOn`. When a dependency is `optional` and fails, downstream subtasks that depend on it must decide what to do:

```typescript
// Agent's evaluation when an optional dependency failed:
interface DependencyFailureEvaluation {
  failedSubtask: string           // ID of the optional subtask that failed
  dependentSubtask: string        // ID of the subtask that depends on it
  canProceedWithout: boolean      // can the dependent still execute without this input?
  fallbackContext?: Record<string, unknown>  // alternative data to use instead
  reasoning: string
}
```

If a `required` subtask depends on an `optional` subtask that failed, the agent evaluates whether the required subtask can still proceed with reduced context. If yes, it continues with a note. If no, it escalates.

#### Example: Win-back with mixed requirements

```
Parent: "Win back Alex (cancelled yesterday)"
  ├── Subtask 1: research_member [required]     — pull Alex's history
  ├── Subtask 2: pull_class_stats [best_effort]  — attendance histogram (nice-to-have)
  ├── Subtask 3: draft_outreach [required, dependsOn: 1]  — write the email
  ├── Subtask 4: send_email [required, dependsOn: 3]      — send it
  ├── Subtask 5: tag_member [optional]           — add PushPress tag
  └── Subtask 6: schedule_followup [required, deferred]   — follow up in 3 days
```

If Subtask 2 (best_effort) fails → silently skipped, draft uses whatever data Subtask 1 provided.
If Subtask 5 (optional) fails → logged, parent continues. Tag can be retried later or ignored.
If Subtask 4 (required) fails → parent escalates. The whole point was to send the email.

---

## 15. Action Types Beyond Email and SMS

The current spec assumes every task ends with `SendEmail`. Real gym operations require many different kinds of actions. The system needs a typed action framework where each action has its own execution logic, safety profile, and reversibility.

### 15.1 Action Type Registry

```typescript
type ActionType =
  // Communication (external, requires safety rails)
  | 'send_email'
  | 'send_sms'

  // PushPress API (external side effects, but reversible)
  | 'tag_member'
  | 'remove_tag'
  | 'update_member_status'
  | 'update_member_notes'
  | 'create_pushpress_task'     // task in PushPress (for staff), not our agent_tasks

  // Internal operations (no external side effects)
  | 'research_member'           // gather data, write to task context
  | 'evaluate_conversation'     // AI reads and scores conversation
  | 'draft_message'             // AI drafts, stores in context (doesn't send)
  | 'create_plan'               // AI creates a structured plan, stores in context
  | 'log_note'                  // write observation to task conversation log

  // Notifications (to gym owner/staff, not members)
  | 'notify_owner'              // email/push to gym owner
  | 'notify_coach'              // alert for a specific coach
  | 'create_escalation'         // formal escalation with context

  // Scheduling
  | 'schedule_followup'         // create a deferred subtask
  | 'schedule_checkin'          // check outcome signals at a future date
```

### 15.2 Action Safety Profiles

Not all actions carry the same risk. The system needs to know which actions are safe to auto-execute and which need review.

```typescript
interface ActionProfile {
  type: ActionType
  riskLevel: 'none' | 'low' | 'medium' | 'high'
  reversible: boolean
  requiresApproval: boolean      // in limited_auto mode
  countsAgainstMessageBudget: boolean
  countsAgainstTurnBudget: boolean
  externalSideEffect: boolean    // does this change anything outside our system?
}

const ACTION_PROFILES: Record<ActionType, ActionProfile> = {
  // Communication — highest risk, always counts against budgets
  send_email:           { riskLevel: 'high',   reversible: false, requiresApproval: true,  countsAgainstMessageBudget: true,  countsAgainstTurnBudget: true,  externalSideEffect: true },
  send_sms:             { riskLevel: 'high',   reversible: false, requiresApproval: true,  countsAgainstMessageBudget: true,  countsAgainstTurnBudget: true,  externalSideEffect: true },

  // PushPress mutations — medium risk, reversible
  tag_member:           { riskLevel: 'low',    reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },
  remove_tag:           { riskLevel: 'low',    reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },
  update_member_status: { riskLevel: 'high',   reversible: true,  requiresApproval: true,  countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },
  update_member_notes:  { riskLevel: 'low',    reversible: false, requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },
  create_pushpress_task:{ riskLevel: 'medium', reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },

  // Internal — no risk, no approval needed
  research_member:      { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: true,  externalSideEffect: false },
  evaluate_conversation:{ riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: true,  externalSideEffect: false },
  draft_message:        { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: true,  externalSideEffect: false },
  create_plan:          { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: true,  externalSideEffect: false },
  log_note:             { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: false },

  // Notifications — low risk (going to owner, not member)
  notify_owner:         { riskLevel: 'low',    reversible: false, requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },
  notify_coach:         { riskLevel: 'low',    reversible: false, requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: true },
  create_escalation:    { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: false },

  // Scheduling — no risk (just sets timers)
  schedule_followup:    { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: false },
  schedule_checkin:     { riskLevel: 'none',   reversible: true,  requiresApproval: false, countsAgainstMessageBudget: false, countsAgainstTurnBudget: false, externalSideEffect: false },
}
```

### 15.3 The Action Executor

A single dispatcher routes each action to its handler. This replaces the hard-coded "send email" logic in section 6.3.

```typescript
async function executeAction(
  task: AgentTask,
  action: { type: ActionType; params: Record<string, unknown> },
): Promise<ActionResult> {
  const profile = ACTION_PROFILES[action.type]

  // ── Pre-flight checks ──

  // Budget check (message budget)
  if (profile.countsAgainstMessageBudget) {
    if (task.budget_messages_used >= task.budget_messages_max) {
      return { success: false, reason: 'message_budget_exhausted', escalate: true }
    }
  }

  // Budget check (turn budget)
  if (profile.countsAgainstTurnBudget) {
    if (task.budget_turns_used >= task.budget_turns_max) {
      return { success: false, reason: 'turn_budget_exhausted', escalate: true }
    }
  }

  // Approval check (in limited_auto mode)
  if (profile.requiresApproval && gym.execution_mode === 'limited_auto') {
    // The task should have been routed to pending_review already.
    // If we're here, something bypassed the gate — block and escalate.
    return { success: false, reason: 'requires_approval', escalate: true }
  }

  // Rate limits (only for member-facing communication)
  if (profile.countsAgainstMessageBudget && task.member_email) {
    const weeklyCount = await countRecentMessages(task.member_email, 7)
    if (weeklyCount >= gym.member_weekly_limit) {
      return { success: false, reason: 'member_rate_limited', retry: true, retryAt: tomorrow() }
    }
  }

  // ── Execute ──
  const handler = ACTION_HANDLERS[action.type]
  if (!handler) {
    return { success: false, reason: `unknown_action_type: ${action.type}`, escalate: true }
  }

  try {
    const result = await handler(task, action.params)

    // Post-execution bookkeeping
    if (profile.countsAgainstMessageBudget) await incrementBudget(task.id, 'messages')
    if (profile.countsAgainstTurnBudget) await incrementBudget(task.id, 'turns')

    await appendConversation(task.id, {
      role: 'system',
      content: `Action executed: ${action.type}`,
      metadata: { actionType: action.type, params: action.params, result },
    })

    return { success: true, data: result }
  } catch (err) {
    await appendConversation(task.id, {
      role: 'system',
      content: `Action failed: ${action.type} — ${err.message}`,
    })
    return { success: false, reason: err.message, escalate: profile.externalSideEffect }
  }
}
```

---

## 16. Completion Detection

"How does the system know a task is completed?" is the hardest question. The answer: **multiple signals, never just one, and always with a confidence score.**

### 16.1 Completion Signals

A task can be completed by any of these:

| Signal | Source | Confidence | Example |
|--------|--------|------------|---------|
| **Outcome signal detected** | Attribution cron (section 9) | High (80-95) | Member checked in after outreach |
| **AI evaluates conversation as resolved** | Conversation loop (section 6.5) | Medium (60-85) | Member replied "thanks, I'll come in tomorrow" |
| **External event confirms goal** | Webhook | High (90+) | PushPress `checkin.created` event for this member |
| **All subtasks completed** | Parent evaluation | Depends on subtask results | All steps done, agent confirms goal met |
| **Owner manually closes** | Dashboard action | 100 | Owner clicks "Mark resolved" |
| **Budget exhausted with positive signal** | Timer/budget | Low (40-60) | Sent all messages, member opened emails but no checkin yet |

### 16.2 How Completion Gets Confused

These are the known failure modes. Each has an explicit handling strategy.

**False positive: "They said they'd come back but didn't"**

The member replies "sounds great, I'll come in this week!" — the AI marks the task `completed` with `outcome: 'engaged'`. But the member never actually comes.

**Mitigation:** Completion from conversation evaluation is **provisional**. The task moves to `completed` but the attribution cron continues checking for the actual outcome signal (checkin) for up to 14 days. If no signal arrives:
- `outcome` is downgraded from `engaged` to `verbal_only`
- `attributed_value` is zeroed out
- This is logged but the task stays `completed` (we don't reopen it — that would create confusion)

```typescript
// In attribute-outcomes cron
if (task.outcome === 'engaged' && task.outcome_source === 'conversation_evaluation') {
  const daysSinceCompletion = daysBetween(task.resolved_at, now)
  if (daysSinceCompletion > 14) {
    const hasCheckin = await checkForCheckin(task)
    if (!hasCheckin) {
      await updateTask(task.id, {
        outcome: 'verbal_only',
        attributed_value: 0,
        outcome_reason: 'no_checkin_after_verbal_commitment',
      })
    }
  }
}
```

**False positive: "Checkin was unrelated to outreach"**

The member checked in, but they were already planning to come back. Did the outreach cause the checkin?

**Mitigation:** We don't try to prove causation. If we reached out and they came back, we count it. This is the same attribution model every marketing tool uses (first-touch/last-touch). The honest way to present this: "Members retained after outreach" — not "Members retained BECAUSE of outreach."

**False negative: "The member came back through a different channel"**

The member sees our email, calls the gym, talks to the front desk, and resumes. Our system sees no checkin webhook yet, no reply. Task times out as `unresponsive`.

**Mitigation:** The attribution cron has a generous window (14 days). Also: if a checkin comes in late, a webhook-driven check can retroactively attribute it, even after the task is closed. The task outcome updates from `unresponsive` to `engaged` — this is an exception to "terminal states are terminal."

```typescript
// Special case: retroactive attribution for closed tasks
if (task.status === 'cancelled' && task.outcome === 'unresponsive') {
  const checkins = await getCheckins(task.member_id, { since: task.execution_started_at })
  if (checkins.length > 0) {
    await updateTask(task.id, {
      outcome: 'engaged_late',
      attributed_value: gym.avg_membership_price,
      outcome_reason: 'checkin_after_task_closed',
    })
    // Note: status stays 'cancelled'. We update the outcome, not the lifecycle.
  }
}
```

**Grey area: "The conversation is going well but no clear resolution"**

Member has been replying, tone is positive, but they haven't committed to anything. Turn 4 of 6.

**Mitigation:** The AI's evaluation prompt explicitly asks: "Can you identify a CONCRETE commitment or signal? If not, this is not resolved." The AI rates its outcome confidence. If confidence < 70 and budget is low, the system escalates rather than letting it time out — this way the owner sees "conversation is warm but stalling" rather than the task silently dying.

**Grey area: "Member asked a question the agent can't answer"**

Member replies: "What are your holiday hours?" or "Can I freeze my membership for a month?"

**Mitigation:** The agent's system prompt includes: "If the member asks a question you cannot answer accurately, DO NOT GUESS. Respond with action: 'escalate' and include the member's question. The gym owner will answer and the conversation can resume." This is a subtask-like operation: the parent task pauses (`escalated`), the owner provides the answer, and the task resumes with that context injected.

### 16.3 The Completion Evaluator

When the agent thinks a task might be done, it runs through a structured checklist:

```typescript
interface CompletionEvaluation {
  goalAchieved: boolean           // did we achieve the stated goal?
  confidence: number              // 0-100: how sure are we?
  evidenceType: 'concrete_signal' | 'verbal_commitment' | 'inferred' | 'none'
  evidence: string                // what specifically tells us this is done?
  outstandingRisks: string[]      // what could still go wrong?
  recommendedAction: 'complete' | 'wait_and_verify' | 'continue' | 'escalate'
}
```

The AI prompt for this:

```
Review this task and its conversation history. The goal was: "{task.goal}"

Evaluate whether the goal has been achieved. Be honest and skeptical.

- "I'll come in tomorrow" is a VERBAL COMMITMENT, not a concrete signal.
  Set evidenceType to 'verbal_commitment' and confidence to 60-75.
- A checkin event, a payment, or a membership reactivation is a CONCRETE SIGNAL.
  Set evidenceType to 'concrete_signal' and confidence to 85-95.
- If you're inferring from tone/sentiment alone, set evidenceType to 'inferred'
  and confidence to 40-60.
- If there's no evidence at all, set goalAchieved to false.

Default to 'wait_and_verify' if you have a verbal commitment but no concrete signal.
Default to 'escalate' if you're below 50% confidence and budget is running low.
```

### 16.4 Completion for Non-Communication Tasks

Not all tasks end with a conversation. Completion detection per action type:

| Action Type | How we know it's done |
|-------------|----------------------|
| `research_member` | AI produced a research summary and stored it in context. Always succeeds. |
| `tag_member` | PushPress API returned 200. Verified by reading member tags. |
| `update_member_status` | PushPress API returned 200. Verified by reading member status. |
| `create_plan` | AI produced a plan. Success = plan exists in context. Quality assessed by parent task evaluation. |
| `draft_message` | Draft stored in context. Success = draft exists. Quality assessed by next step. |
| `schedule_followup` | Subtask created with future `next_action_at`. Success = subtask exists. |
| `notify_owner` | Email sent via Resend. Success = Resend accepted the message. |

For API calls: success = HTTP 2xx. Failure = retry once, then escalate.
For AI operations: success = output exists and passes basic validation. There is no "the AI did a bad job" detection at the subtask level — the parent task's agent evaluates quality when deciding next steps.

---

## 17. Human Handoff and Pipeline Blocking

When a task (or subtask) can't proceed autonomously, it needs to hand off to a human cleanly without losing context or creating confusion.

### 17.1 Why Tasks Get Stuck

| Situation | Detection | Response |
|-----------|-----------|----------|
| Member asked a question agent can't answer | AI returns `action: 'escalate'` with the question | Escalate to owner with the specific question |
| Agent drafted a message but confidence is low | Confidence < 50 at reply-time | Escalate with draft attached for owner to edit/approve |
| External API failed (PushPress down) | HTTP error from action executor | Retry once. If still failing, escalate with error context |
| Member is angry or threatening | AI sentiment analysis detects hostility | Immediate escalate. Flag as high-priority. No auto-retry. |
| Agent is confused about what to do next | AI returns low confidence on plan step | Escalate with "I'm not sure how to proceed" + context |
| Subtask depends on information the agent doesn't have | AI identifies missing data | Escalate with specific request: "I need to know [X] to continue" |

### 17.2 What Happens When a Task Escalates

1. **Parent task moves to `escalated`** — the whole pipeline pauses.
2. **All active subtasks pause** — no new subtask execution while parent is escalated.
3. **Owner sees the escalation in the dashboard** — with full context:
   - What the agent was trying to do
   - What specifically blocked it
   - The conversation history so far
   - What the agent recommends (if it has a suggestion)
4. **Owner has three options:**
   - **Provide guidance** → The owner types a response/instruction. The task moves back to `executing` with the owner's input injected into the conversation context. The agent continues from where it left off.
   - **Take over** → The owner handles it manually. The task moves to `completed` with `outcome_reason: 'owner_handled'`.
   - **Cancel** → The task moves to `cancelled`. No further action.

### 17.3 Escalation Context Object

```typescript
interface EscalationContext {
  blockedAt: string                   // timestamp
  blockedBy: 'subtask' | 'agent' | 'system' | 'member'
  blockedSubtaskId?: string           // which subtask is stuck
  reason: string                      // human-readable explanation
  question?: string                   // specific question for the owner
  draftReply?: string                 // agent's best attempt (for owner to edit)
  suggestedActions: string[]          // what the agent thinks the owner could do
  conversationSnapshot: {             // last few messages for quick context
    role: string
    content: string
    timestamp: string
  }[]
  resumeInstructions?: string         // what the agent will do when unblocked
}
```

### 17.4 Resuming After Escalation

When the owner provides guidance:

```typescript
async function resumeFromEscalation(taskId: string, ownerInput: string) {
  const task = await getTask(taskId)

  // Inject owner guidance into conversation
  await appendConversation(taskId, {
    role: 'owner',
    content: ownerInput,
  })

  // Transition back to executing
  await transitionTask(taskId, 'executing', {
    reason: 'owner_provided_guidance',
  })

  // The next cron tick will pick up the task and continue.
  // The agent will see the owner's message in the conversation history
  // and incorporate it into its next action.
}
```

Key design decision: **owner input goes into the conversation history, not into a separate "instructions" field.** This way the agent naturally reads it as context, just like a member reply. The agent's system prompt tells it: "Messages from 'owner' are instructions from the gym owner. Follow them."

### 17.5 Timeout Escalations

If a task sits in `escalated` for > 48 hours with no owner action:
- Send the owner a reminder notification
- After 7 days: auto-cancel with `outcome_reason: 'escalation_timeout'`
- Log it: "This task was escalated but not addressed within 7 days."

This prevents a pile-up of stale escalations blocking the owner's queue.

---

## 18. Grey Area Resolution Framework

Every decision point in the pipeline has ambiguity. The system needs a consistent framework for handling uncertainty rather than ad-hoc rules scattered through the code.

### 18.1 The Decision Framework

At every decision point, the system asks three questions in order:

```
1. Is there a HARD RULE that applies?
   → If yes: follow the rule. No AI involved. (Rate limits, budget caps, blocked statuses.)

2. Is the AI CONFIDENT (>= threshold)?
   → If yes: proceed. Log the decision and confidence.
   → If no: go to step 3.

3. Is the cost of being wrong HIGH?
   → If yes: escalate to owner.
   → If no: proceed with the safer option and log the uncertainty.
```

"Cost of being wrong" is determined by the action's safety profile (section 15.2):
- `externalSideEffect: true` + `reversible: false` = high cost (sending a bad email)
- `externalSideEffect: true` + `reversible: true` = medium cost (adding a wrong tag)
- `externalSideEffect: false` = low cost (bad research summary, bad draft — agent can redo)

### 18.2 Decision Points and Their Grey Areas

**Decision: Should we create a task for this member?**

Grey area: The analysis says the member is at risk, but the data is sparse (new member, few checkins to establish a pattern).

Resolution: Create the task but lower the confidence score. With low confidence, it will route to `pending_review` where the owner can decide. The system never ignores a potential issue — it just adjusts how aggressively it acts.

**Decision: Is this the right message to send?**

Grey area: The agent drafted a message, but the member's situation is ambiguous (e.g., they stopped coming but recently posted on Instagram about being sick).

Resolution: The agent can't access Instagram. If the draft feels like a reach (low confidence), it escalates with: "I want to send this but I'm not sure about the member's situation. Here's my draft — should I send it?" The owner can edit, approve, or cancel.

**Decision: Did the member's reply mean they're coming back?**

Grey area: Member replied "maybe" or "I'll think about it" — not a yes, not a no.

Resolution: This maps to `action: 'wait'` in the evaluation. The agent says: "They haven't committed but aren't saying no. I'll follow up in [X] days." The task stays `waiting`. If the budget runs out, it closes as `unresponsive` — which is accurate.

**Decision: Should this task be completed or keep going?**

Grey area: The member replied positively but no concrete signal yet. 2 messages left in budget.

Resolution: The completion evaluator (section 16.3) returns `recommendedAction: 'wait_and_verify'`. The task stays `waiting` with a scheduled check. The remaining message budget is preserved in case the member needs a gentle nudge later.

**Decision: Is this member the same person as the one in PushPress?**

Grey area: Email doesn't match but name does. Or: PushPress has two members with similar names.

Resolution: Member identity is always matched by PushPress `member_id` (unique), never by name or email alone. If we can't get a `member_id` match, we don't proceed — the task escalates with: "I found a potential match but can't confirm identity. Can you verify?"

**Decision: Should the agent try a different approach after failure?**

Grey area: First email got no response. Should the second email change tone? Try a different angle?

Resolution: The task type's `systemPrompt` includes escalating outreach instructions:
- Touch 1: Friendly, low-pressure check-in
- Touch 2: Slightly more direct, acknowledge the silence, offer help
- Touch 3: Final note, explicitly leave the door open, no guilt

This isn't the agent "deciding" to change approach — it's following a pre-defined playbook. The agent's creativity is constrained to drafting within the playbook's parameters, not choosing the strategy.

### 18.3 The "I Don't Know" Action

The most important design choice: **the agent can always say "I don't know."**

Every AI evaluation has `'escalate'` as a valid action. The system prompt explicitly says:

```
If you are unsure about ANY of the following, choose action: 'escalate':
- Whether the member's situation warrants outreach
- Whether your draft message is appropriate
- Whether the member's reply is positive, negative, or ambiguous
- Whether the goal has been achieved
- Whether you should continue or stop

It is ALWAYS better to escalate than to guess wrong. The gym owner can handle
ambiguity better than you can — they know their members personally.
```

This is the escape hatch for every grey area. The system doesn't need to handle every edge case perfectly. It needs to handle common cases well and recognize uncommon cases early.

### 18.4 Decision Audit Trail

Every decision is logged with enough context to understand WHY it was made:

```typescript
interface DecisionLog {
  taskId: string
  timestamp: string
  decisionPoint: string           // 'task_creation_gate' | 'reply_evaluation' | 'completion_check' | etc.
  input: Record<string, unknown>  // what data the decision was based on
  confidence: number              // how confident the system was
  decision: string                // what was decided
  reasoning: string               // why (from AI or rule)
  alternative: string             // what would have happened at lower confidence
  appliedRule?: string            // if a hard rule triggered, which one
}
```

This lives in the `task_conversations` table as system messages. The owner can always expand a task and see the full decision history — not just messages sent, but every fork in the road the system navigated.

---

## 19. Long-Running Task Scenarios (Walkthrough)

This section walks through specific real-world scenarios to show how the cadence, dormant state, and wakeup mechanics work together.

### 19.1 "Member on vacation for 2 weeks"

**Task type:** `churn_risk` (cadence: `standard` — intervals [3, 5, 7], onExhaustion: `cancel`)

```
Day 0:  Send initial email. Touch 0. → waiting, next_action_at = Day 3.
Day 3:  No reply. Send follow-up #1 (friendly_checkin). Touch 1. → waiting, next_action_at = Day 8.
Day 8:  No reply. Send follow-up #2 (direct_offer_help). Touch 2. → waiting, next_action_at = Day 15.
Day 14: Budget expires (maxDays: 14). → cancelled, outcome: unresponsive.
```

With `standard` cadence, this is correct — we tried 3 times over 2 weeks, they didn't respond. But what if this was a win-back task?

**Task type:** `win_back` (cadence: `slow_burn` — intervals [3, 10, 21], onExhaustion: `dormant`, dormantMaxDays: 90)

```
Day 0:  Send initial email (personal_note). Touch 0. → waiting, next_action_at = Day 3.
Day 3:  No reply. Send follow-up #1 (different_angle). Touch 1. → waiting, next_action_at = Day 13.
Day 13: No reply. Send follow-up #2 (final_door_open). Touch 2. → waiting, next_action_at = Day 34.
Day 30: Budget expires (maxDays: 30). All touches used. onExhaustion = dormant.
         → dormant, dormant_check_at = Day 37, dormant_expires_at = Day 120.
Day 37: Dormant check — no checkin, no reactivation. Schedule next check Day 51.
Day 51: Dormant check — no signal. Schedule next check Day 65.
Day 60: Member comes back from extended trip, checks in. Attribution cron detects checkin.
         → completed, outcome: 'engaged', attributed_value: $150.
```

The system didn't spam them while they were away. It sent 3 messages at increasing intervals, then went quiet and just watched. When they came back, it got the credit.

### 19.2 "Member replies after task went dormant"

```
Day 0-30: Same as above. Task goes dormant.
Day 45:   Member replies to the Day 13 email: "Hey, sorry I've been traveling.
           I'm back and want to rejoin."

Inbound webhook routes reply to task.
handleMemberReply detects task.status === 'dormant'.
→ dormant → executing (wakeup).
AI evaluates: member wants to rejoin. Confidence 90. action: 'close'.
→ completed, outcome: 'recovered'.
```

The dormant task was reactivated by the member's reply. The agent didn't have to do anything — the member came back on their own terms.

### 19.3 "Urgent payment recovery — can't wait"

**Task type:** `payment_recovery` (cadence: `urgent` — intervals [1, 2, 3], onExhaustion: `escalate`)

```
Day 0: Send payment notice (friendly_urgent). → waiting, next_action_at = Day 1.
Day 1: No reply. Send follow-up (direct_followup). → waiting, next_action_at = Day 3.
Day 3: No reply. Send final (escalation_warning). → waiting, next_action_at = Day 6.
Day 6: All touches used. onExhaustion = escalate.
        → escalated. Owner sees: "Payment still failing. 3 messages sent, no response."
```

The system doesn't let payment issues go dormant. It escalates to the owner because this needs human judgment — maybe the owner should call them, adjust the billing, or accept the loss.

### 19.4 "Lead goes cold, then comes back 2 months later"

**Task type:** `lead_followup` (cadence: `patient` — intervals [5, 10, 14], onExhaustion: `dormant`, dormantMaxDays: 60)

```
Day 0:  Lead form → create task → send welcome email.
Day 5:  No reply. Follow-up #1 (warm_checkin).
Day 15: No reply. Follow-up #2 (gentle_followup).
Day 21: Budget expires. All touches used. → dormant.
Day 50: Lead walks in for a trial (checkin event from PushPress webhook).
         Dormant check finds the checkin signal.
         → completed, outcome: 'trial_booked'.
```

Without the dormant state, this would have been `cancelled` on day 21 and we'd never attribute the win. With dormant, we caught it.

### 19.5 "Member replies to the WRONG task"

The member gets an email from a `churn_risk` task and a `payment_recovery` task in the same week. They reply to the churn email but talk about their payment.

This is handled in the conversation loop's AI evaluation. The AI sees the reply content ("my card was stolen, I'm getting a new one") and the task context (churn risk outreach). It recognizes this is about payment, not attendance. It sets:

```
action: 'escalate'
reason: "Member's reply is about a payment issue, not about attendance.
         This should be routed to the payment recovery task."
```

The owner sees the escalation and can either:
- Provide guidance ("forward this context to the payment task")
- Handle it manually

The system doesn't try to auto-route between tasks — that's a recipe for confusion. It surfaces the mismatch and lets the human decide.

---

## 20. Extensibility: Handling Future Task Types

The architecture must handle task types we haven't imagined yet. Here's how the three layers (Task Type Registry, Action Type Registry, Subtask Model) combine to support various scenarios:

### 19.1 Example: "Fill Underbooked Class"

```typescript
// Task type
underbooked_class: {
  type: 'underbooked_class',
  label: 'Fill Underbooked Class',
  agent: 'fill',
  priority: 'medium',
  budget: { maxMessages: 5, maxDays: 2, maxTurns: 8 },  // tight window
  autoThreshold: 85,
  escalationTriggers: [],
  systemPrompt: `...`,
  outcomeSignals: ['class_booking'],
}

// Subtask decomposition by agent:
// 1. research_member (x5) — find 5 members who liked this class type, haven't been this week
// 2. draft_message (x5) — personalize for each
// 3. send_email (x5) — send all (within budget and rate limits)
// 4. schedule_checkin — check bookings in 24 hours
```

### 19.2 Example: "Coach Briefing"

```typescript
coach_briefing: {
  type: 'coach_briefing',
  label: 'Daily Coach Briefing',
  agent: 'gm',
  priority: 'low',
  budget: { maxMessages: 1, maxDays: 1, maxTurns: 3 },
  autoThreshold: 95,  // always auto
  escalationTriggers: [],
  systemPrompt: `Compile a daily briefing for the coach...`,
  outcomeSignals: [],  // no measurable outcome — fire and forget
}

// No subtasks needed — single action: research + draft + notify_coach
```

### 19.3 Example: "Payment Recovery"

```typescript
// Already in registry. But the subtask decomposition shows its power:
// 1. research_member — pull payment history, how many failures, tenure
// 2. check with PushPress API — is the payment still failing or already resolved?
//    → if resolved: complete task immediately (outcome: 'self_resolved')
//    → if still failing: continue
// 3. draft_message — sensitive, non-embarrassing note about updating payment
// 4. send_email — send it
// 5. schedule_checkin — check payment status in 3 days
//    → if payment succeeded: complete (outcome: 'recovered')
//    → if still failing + no reply: draft a follow-up
//    → if member replied: enter conversation loop
```

### 19.4 Example: "Reputation Request (Google Review)"

```typescript
// Already in registry (section 12 example). Single action, no subtasks.
// The agent drafts a congratulatory email with a soft review ask.
// Outcome: we can't detect if a review was posted (Google API limitation).
// So outcomeSignals: [] — fire and forget with no attribution.
// Future: if we integrate Google Business API, add 'review_posted' signal.
```

The pattern: **complex tasks decompose into subtasks, simple tasks execute as single actions.** The pipeline handles both. The agent decides which approach to take based on the task type's complexity.

---

## 21. Member-Level Coordination

The deduplication in §7.7 prevents duplicate tasks of the same *type* for a member. But a member can have a `churn_risk` task, a `payment_recovery` task, and an `onboarding` task all active simultaneously — each unaware of the others, each trying to send messages, each with a different tone. To the member, this looks like a confused system.

### 21.1 Don't Combine Tasks — Coordinate Them

Combining tasks into one (e.g., "re-engage Sarah AND recover her payment") sounds clean but breaks the model:
- Can't track each goal's outcome independently
- Can't attribute revenue to the right intervention
- The agent's prompt becomes muddled ("you're doing 3 things at once")
- If one goal succeeds and another fails, what's the task status?

Instead: **keep tasks separate but coordinate at the member level.** Each task tracks its own goal and outcome. A coordination layer decides which task gets to act and when.

### 21.2 The Member Coordinator

Before any task executes an outbound action for a member, it checks the member's full task context.

```typescript
interface MemberTaskContext {
  memberId: string
  memberEmail: string
  activeTasks: {
    taskId: string
    taskType: string
    priority: 'critical' | 'high' | 'medium' | 'low'
    status: TaskStatus
    lastMessageAt: string | null
    messagesThisWeek: number
  }[]
  weeklyMessagesUsed: number
  weeklyMessageBudget: number
  suppressed: boolean              // opt-out (see §22)
}

async function getMemberTaskContext(memberEmail: string, accountId: string): Promise<MemberTaskContext> {
  const activeTasks = await supabaseAdmin
    .from('agent_tasks')
    .select('id, task_type, priority, status, last_activity_at, budget_messages_used')
    .eq('account_id', accountId)
    .eq('member_email', memberEmail)
    .not('status', 'in', '("completed","cancelled")')
    .order('priority')

  const weeklyMessages = await countRecentMessages(memberEmail, 7)
  const suppressed = await isMemberSuppressed(memberEmail, accountId)

  return { memberId, memberEmail, activeTasks, weeklyMessagesUsed: weeklyMessages, ... }
}
```

### 21.3 Priority-Based Message Allocation

When multiple tasks compete for the same member's limited message slots:

```typescript
const TASK_PRIORITY_ORDER: Record<string, number> = {
  critical: 0,   // payment_recovery — money is at stake
  high: 1,       // churn_risk, win_back — retention is the north star
  medium: 2,     // lead_followup, onboarding
  low: 3,        // milestone_review, coach_briefing
}
```

Rules:
1. **Higher-priority tasks get first access to message slots.** If a `payment_recovery` (critical) and a `churn_risk` (high) both want to send, the payment task goes first.
2. **Lower-priority tasks are paused, not cancelled.** If Sarah has 1 message slot left this week and both tasks want it, the churn task is deferred to next week (its `next_action_at` is pushed out). It doesn't lose a touch — the touch is delayed, not skipped.
3. **Only one outbound message per member per day.** Even within the weekly limit, spreading messages across days prevents the "3 emails in 2 hours" effect.
4. **Cross-task context is injected into the AI prompt.** When the churn agent drafts a message for Sarah, it sees: "Note: this member also has an active payment recovery task. Avoid conflicting messaging — do not mention payment or billing." This prevents tone collisions without combining the tasks.

```typescript
// In the task executor, before sending:
async function canSendToMember(task: AgentTask): Promise<{ allowed: boolean; reason?: string; retryAt?: Date }> {
  const ctx = await getMemberTaskContext(task.member_email, task.account_id)

  if (ctx.suppressed) {
    return { allowed: false, reason: 'member_opted_out' }
  }

  if (ctx.weeklyMessagesUsed >= ctx.weeklyMessageBudget) {
    return { allowed: false, reason: 'weekly_limit', retryAt: nextWeek() }
  }

  // One message per member per day
  const sentToday = ctx.activeTasks.some(t =>
    t.lastMessageAt && isToday(t.lastMessageAt)
  )
  if (sentToday) {
    return { allowed: false, reason: 'daily_member_limit', retryAt: tomorrow() }
  }

  // Priority check: is a higher-priority task waiting to send?
  const higherPriorityWaiting = ctx.activeTasks.some(t =>
    t.taskId !== task.id &&
    TASK_PRIORITY_ORDER[t.priority] < TASK_PRIORITY_ORDER[task.priority] &&
    ['ready', 'executing'].includes(t.status)
  )
  if (higherPriorityWaiting && ctx.weeklyMessagesUsed >= ctx.weeklyMessageBudget - 1) {
    // Only 1 slot left — save it for the higher-priority task
    return { allowed: false, reason: 'yielding_to_higher_priority', retryAt: tomorrow() }
  }

  return { allowed: true }
}
```

### 21.4 Cross-Task Awareness in AI Prompts

When the AI drafts or evaluates for a task, it sees what else is happening:

```
MEMBER CONTEXT:
- This member has 2 active tasks:
  1. [payment_recovery, critical] Payment failed 3 days ago. First message sent, awaiting reply.
  2. [churn_risk, high] Haven't checked in for 18 days. THIS IS YOUR TASK.

IMPORTANT: Do NOT mention payment or billing issues — that's being handled separately.
Focus only on the attendance/engagement angle.
```

This is injected automatically by the executor. The agent doesn't need to query other tasks — the system provides the context.

---

## 22. Member Opt-Out and Suppression

### 22.1 Two Levels of Stop

| Level | Trigger | Effect | Reversible? |
|-------|---------|--------|-------------|
| **Task-level** | Owner cancels one task | That task stops. Other tasks for this member continue. | Yes — owner can create a new task |
| **Member-level** | Member says "stop" / clicks unsubscribe | ALL tasks for this member across ALL types are halted. No outbound messages of any kind. | Yes — only by the member re-engaging or owner manually removing suppression |

### 22.2 Suppression Table

```sql
CREATE TABLE member_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  member_email TEXT NOT NULL,
  member_id TEXT,
  reason TEXT NOT NULL,            -- 'member_request' | 'unsubscribe_link' | 'owner_override' | 'complaint'
  source TEXT NOT NULL,            -- 'inbound_reply' | 'unsubscribe_webhook' | 'dashboard' | 'system'
  source_task_id UUID,             -- which task triggered this
  created_at TIMESTAMPTZ DEFAULT NOW(),
  removed_at TIMESTAMPTZ,          -- null = active suppression
  removed_by TEXT,                 -- 'owner' | 'member_reactivation'

  UNIQUE(account_id, member_email) WHERE removed_at IS NULL  -- only one active suppression per member per gym
);
```

### 22.3 Detection

Three detection mechanisms, all feeding into the same suppression:

**1. Keyword detection on inbound replies (hard rule, no AI involved):**

```typescript
const STOP_KEYWORDS = [
  'stop', 'unsubscribe', 'opt out', 'opt-out', 'remove me',
  'don\'t email', 'dont email', 'don\'t contact', 'dont contact',
  'leave me alone', 'take me off', 'no more emails',
]

function containsOptOut(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return STOP_KEYWORDS.some(kw => lower.includes(kw))
}
```

This runs BEFORE the AI evaluation. If detected:
- Immediately suppress the member
- Cancel all active tasks for this member
- Notify the owner: "Sarah requested to stop receiving messages. All outreach has been halted."
- Do NOT send any acknowledgment email (they said stop — stop means stop)

**2. Unsubscribe link in every email:**

Every outbound email includes a one-click unsubscribe link (CAN-SPAM requirement). The link hits `/api/unsubscribe?token={jwt}` which:
- Validates the token (contains memberEmail, accountId)
- Inserts into `member_suppressions`
- Returns a simple "You've been unsubscribed" page
- Cancels all active tasks for this member

**3. AI-detected hostility or refusal:**

The AI evaluation can also trigger suppression if the member's tone is clearly hostile or they express refusal in a way the keyword list doesn't catch (e.g., "I don't want to hear from you people again"). The AI sets `action: 'escalate'` with `suggestSuppression: true`. The system auto-suppresses and notifies the owner.

### 22.4 Enforcement

```typescript
// Checked at the TOP of every outbound action, before anything else
async function isMemberSuppressed(email: string, accountId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('member_suppressions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('member_email', email)
    .is('removed_at', null)

  return (count ?? 0) > 0
}
```

If suppressed: task immediately transitions to `cancelled` with `outcome_reason: 'member_opted_out'`. No retry, no escalation, no "but the message was really good." Stop means stop.

---

## 23. Gym Context and Personalization

### 23.1 The Gym Profile

Every AI call needs to sound like it's coming from the gym, not from a generic SaaS. This requires a structured gym profile that feeds into every prompt.

```sql
-- Additions to gyms table
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS profile JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS send_window_start INT DEFAULT 8,   -- 8am local
  ADD COLUMN IF NOT EXISTS send_window_end INT DEFAULT 20;    -- 8pm local
```

The `profile` JSONB holds:

```typescript
interface GymProfile {
  // Identity
  displayName: string          // "CrossFit Renegade" (not the legal name)
  gymType: string              // 'crossfit_box' | 'yoga_studio' | 'boutique_gym' | 'martial_arts' | etc.
  ownerFirstName: string       // "Mike" — for sign-offs
  vibe: string                 // 'casual_friendly' | 'motivational' | 'professional' | 'community_first'

  // Context the AI needs
  classTypes?: string[]        // ['WOD', 'Olympic Lifting', 'Open Gym', 'Yoga']
  specialPrograms?: string[]   // ['Foundations Course', '6-Week Challenge']
  currentPromo?: string        // 'Bring a friend free this month'
  typicalGreeting?: string     // 'Hey!' vs 'Hi there,' vs 'Good morning,'

  // Communication rules
  neverMention?: string[]      // ['competitor names', 'weight loss']
  alwaysInclude?: string[]     // ['our address', 'front desk phone number']
  signOff?: string             // 'Coach Mike' vs 'The Renegade Team' vs 'Mike & Sarah'
  contactInfo?: {
    phone?: string
    address?: string
    website?: string
  }
}
```

### 23.2 How It Feeds Into Prompts

Every AI call wraps the task-type system prompt with gym context:

```typescript
function buildFullPrompt(gym: Gym, typeDef: TaskTypeDef, task: AgentTask): string {
  const p = gym.profile as GymProfile

  return `
${typeDef.systemPrompt}

GYM CONTEXT:
- Gym: ${p.displayName} (${p.gymType.replace('_', ' ')})
- Owner: ${p.ownerFirstName}
- Vibe: ${p.vibe}
- Classes: ${p.classTypes?.join(', ') ?? 'general fitness'}
${p.currentPromo ? `- Current promotion: ${p.currentPromo}` : ''}
${p.neverMention?.length ? `- NEVER mention: ${p.neverMention.join(', ')}` : ''}

COMMUNICATION STYLE:
- Greeting: "${p.typicalGreeting ?? 'Hey'}"
- Sign off as: "${p.signOff ?? p.ownerFirstName ?? 'The Team'}"
- Tone: ${p.vibe ?? 'friendly and genuine'}
- This should read like a personal note from someone at the gym, NOT like a marketing email.

${p.contactInfo ? `If the member needs to reach the gym: ${p.contactInfo.phone ?? ''} ${p.contactInfo.address ?? ''}` : ''}
`
}
```

### 23.3 Agent and Task Type Override Files (Optional)

For gyms that want deeper customization, agent-specific instruction files can be stored in the `account_agent_configs` table:

```sql
CREATE TABLE account_agent_configs (
  account_id UUID NOT NULL REFERENCES accounts(id),
  agent_type TEXT NOT NULL,        -- 'retention' | 'sales' | 'gm' | '*' (all agents)
  task_type TEXT,                   -- null = all task types for this agent
  prompt_override TEXT,             -- replaces the default system prompt entirely
  prompt_additions TEXT,            -- appended to the default system prompt
  context JSONB,                    -- additional context specific to this gym+agent combo
  PRIMARY KEY (account_id, agent_type, COALESCE(task_type, '*'))
);
```

The prompt builder checks for overrides:

```typescript
function getEffectivePrompt(gym: Gym, typeDef: TaskTypeDef): string {
  // Check for task-type-specific override first, then agent-level, then default
  const override = gymAgentConfigs.find(c =>
    c.account_id === gym.id &&
    c.agent_type === typeDef.agent &&
    c.task_type === typeDef.type
  ) ?? gymAgentConfigs.find(c =>
    c.account_id === gym.id &&
    c.agent_type === typeDef.agent &&
    c.task_type === null
  )

  if (override?.prompt_override) return override.prompt_override
  const base = typeDef.systemPrompt
  if (override?.prompt_additions) return base + '\n\n' + override.prompt_additions
  return base
}
```

This lets us (or the owner) say: "For churn_risk tasks at CrossFit Renegade, always mention the upcoming competition" without touching code.

### 23.4 Profile Bootstrapping

On gym connect, we auto-populate the profile from PushPress data where possible:
- `displayName` from PushPress gym name
- `timezone` from PushPress gym settings (or geolocated from address)
- During onboarding, the owner answers 3-4 questions: "What do you call your gym?", "How do you typically greet members?", "What's your vibe?"

The profile is editable in Settings. It's not a one-time setup — owners can update it as their gym evolves.

---

## 24. Email Threading

### 24.1 Thread Model

All messages for a single task are part of one email thread. The member sees a conversation, not a series of unrelated emails.

```sql
-- Additions to outbound_messages table
ALTER TABLE outbound_messages
  ADD COLUMN IF NOT EXISTS email_message_id TEXT,    -- RFC 2822 Message-ID header value
  ADD COLUMN IF NOT EXISTS email_in_reply_to TEXT,   -- In-Reply-To header (references previous message)
  ADD COLUMN IF NOT EXISTS email_references TEXT[];   -- References header (full thread chain)
```

### 24.2 Outbound: Threading Follow-Ups

When sending a follow-up or reply, the system finds the previous message in the thread:

```typescript
async function getThreadHeaders(taskId: string): Promise<{
  inReplyTo?: string
  references?: string[]
  subject: string
}> {
  // Get all messages for this task, ordered by creation
  const { data: messages } = await supabaseAdmin
    .from('outbound_messages')
    .select('email_message_id, subject')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (!messages?.length) {
    return { subject: originalSubject }
  }

  const messageIds = messages.map(m => m.email_message_id).filter(Boolean)
  const lastMessageId = messageIds[messageIds.length - 1]

  return {
    inReplyTo: lastMessageId,
    references: messageIds,
    // Follow-ups use "Re: " prefix — email clients use this + References header to thread
    subject: messages[0].subject.startsWith('Re: ')
      ? messages[0].subject
      : `Re: ${messages[0].subject}`,
  }
}

// When sending via Resend:
const threadHeaders = await getThreadHeaders(task.id)

await resend.emails.send({
  from: `${gym.profile.displayName} <${fromAddress}>`,
  to: task.member_email,
  subject: threadHeaders.subject,
  html: body,
  replyTo: `reply+${task.id}@replies.gymagents.com`,
  headers: {
    ...(threadHeaders.inReplyTo && { 'In-Reply-To': threadHeaders.inReplyTo }),
    ...(threadHeaders.references && { 'References': threadHeaders.references.join(' ') }),
  },
})
```

### 24.3 Inbound: Receiving Replies in the Thread

The existing `Reply-To: reply+{taskId}@...` header routes replies to the right task. The inbound webhook already receives the full email including headers. We store the member's `Message-ID` so our next reply threads correctly off their message:

```typescript
// In inbound email webhook
async function handleInboundEmail(payload: InboundEmail) {
  const taskId = extractTaskIdFromReplyTo(payload.to)
  if (!taskId) return

  // Store the member's Message-ID for threading
  await supabaseAdmin
    .from('task_conversations')
    .insert({
      task_id: taskId,
      role: 'member',
      content: payload.text || payload.html,
      metadata: {
        emailMessageId: payload.headers?.['message-id'],
        emailSubject: payload.subject,
      },
    })

  // Now the conversation loop handles evaluation and response (§6.5)
  await handleMemberReply(taskId, payload.text || payload.html)
}
```

### 24.4 What the Member Sees

```
┌─────────────────────────────────────────────────┐
│ From: CrossFit Renegade <outreach@cr.gym...>    │
│ Subject: Hey Alex — checking in                 │
│                                                 │
│ Hey Alex,                                       │
│ Haven't seen you at the box in a while...       │
│ - Coach Mike                                    │
├─────────────────────────────────────────────────┤
│ From: CrossFit Renegade <outreach@cr.gym...>    │
│ Subject: Re: Hey Alex — checking in             │
│                                                 │
│ Hey Alex, just wanted to follow up —            │
│ everything good?                                │
│ - Coach Mike                                    │
├─────────────────────────────────────────────────┤
│ From: Alex <alex@gmail.com>                     │
│ Subject: Re: Hey Alex — checking in             │
│                                                 │
│ Hey! Sorry, been traveling. Back next week.     │
├─────────────────────────────────────────────────┤
│ From: CrossFit Renegade <outreach@cr.gym...>    │
│ Subject: Re: Hey Alex — checking in             │
│                                                 │
│ Awesome, glad to hear it! See you next week.    │
│ - Coach Mike                                    │
└─────────────────────────────────────────────────┘
```

One thread. Looks like a human conversation. Not three separate marketing emails.

---

## 25. Race Condition Protection

### 25.1 The Problem

Two code paths can touch the same task simultaneously:
- Cron processes a follow-up for Sarah (status: `waiting` → `executing`)
- Sarah replies at the same moment. Webhook fires `handleMemberReply`.
- Both try to transition the task. One succeeds, one throws "invalid transition."
- Worse: the follow-up draft was already generated. Does it send? Does it collide with the reply handling?

### 25.2 Optimistic Locking

Add a version column to `agent_tasks`:

```sql
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
```

Every state transition increments the version and checks it atomically:

```typescript
async function transitionTask(
  taskId: string,
  newStatus: TaskStatus,
  metadata?: Record<string, unknown>,
): Promise<{ success: boolean; currentVersion: number }> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const allowed = VALID_TRANSITIONS[task.status as TaskStatus]
  if (!allowed?.includes(newStatus)) {
    throw new Error(`Invalid transition: ${task.status} → ${newStatus}`)
  }

  // Atomic update: only succeeds if version hasn't changed
  const { data, error } = await supabaseAdmin
    .from('agent_tasks')
    .update({
      status: newStatus,
      version: task.version + 1,
      last_activity_at: new Date().toISOString(),
      ...buildUpdateFields(newStatus, metadata),
    })
    .eq('id', taskId)
    .eq('version', task.version)    // ← optimistic lock
    .select('version')
    .single()

  if (error || !data) {
    // Someone else changed the task between our read and write.
    // This is expected in race conditions — not an error.
    return { success: false, currentVersion: task.version }
  }

  // Log the transition
  await appendConversation(taskId, {
    role: 'system',
    content: `Status: ${task.status} → ${newStatus}${metadata?.reason ? ` (${metadata.reason})` : ''}`,
  })

  return { success: true, currentVersion: data.version }
}
```

### 25.3 What Callers Do on Conflict

When `transitionTask` returns `{ success: false }`, the caller re-reads the task and re-evaluates:

```typescript
// In the task ticker (follow-up processing):
async function executeFollowUp(task: AgentTask, cadenceContext: CadenceContext) {
  // Try to claim the task by transitioning waiting → executing
  const result = await transitionTask(task.id, 'executing', { reason: 'follow_up_due' })

  if (!result.success) {
    // Someone else transitioned first (probably a member reply).
    // Re-read and check: if the task is now 'executing' due to a reply,
    // the reply handler will take it from here. Our follow-up is no longer needed.
    const current = await getTask(task.id)
    console.log(`[ticker] Task ${task.id} was transitioned by another process (now: ${current.status}). Skipping follow-up.`)
    return
  }

  // We own the task. Draft and send the follow-up.
  // ...
}

// In the reply handler:
async function handleMemberReply(taskId: string, replyContent: string) {
  const task = await getTask(taskId)

  // If the task is 'executing' (cron grabbed it for a follow-up), wait briefly
  // and re-check. The cron will finish quickly.
  if (task.status === 'executing') {
    await sleep(2000)  // 2 seconds — the cron operation is fast
    const refreshed = await getTask(taskId)
    if (refreshed.status !== 'waiting') {
      // Cron finished and transitioned to waiting. Proceed with reply handling.
      // (If it sent a follow-up, the member's reply comes after that — fine.)
    }
  }

  // Log the reply regardless of state — member replies are never lost
  await appendConversation(taskId, { role: 'member', content: replyContent })

  // Transition to executing for reply processing
  const result = await transitionTask(taskId, 'executing', { reason: 'member_reply' })
  if (!result.success) {
    // Edge case: someone else is already handling this. Queue for next tick.
    await updateTask(taskId, { next_action_at: addMinutes(new Date(), 1) })
    return
  }

  // Process the reply...
}
```

### 25.4 Key Principle

**Member replies are never lost.** Even if a race condition prevents immediate processing, the reply is always logged to `task_conversations`. The next cron tick will see it and process it. The worst case is a 60-second delay, not a lost message.

**Follow-ups gracefully yield to replies.** If a member replies at the same moment as a scheduled follow-up, the reply takes priority. The follow-up is skipped (the member is already engaging — a follow-up would be redundant).

---

## 26. Onboarding Ramp-Up

### 26.1 The Problem

Day 1: gym connects PushPress. Analysis cron runs. Finds 150 at-risk members. In manual mode, the owner has 25 tasks to review before breakfast. In limited_auto mode, the system starts emailing 15 members/day immediately — before the owner has even seen a single draft, confirmed the tone is right, or understood the product.

### 26.2 Ramp-Up Phases

When a gym connects (or enables a new agent/task type), it enters a graduated ramp:

```sql
-- Additions to gyms table
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ramp_phase TEXT DEFAULT 'shadow'
    CHECK (ramp_phase IN ('shadow', 'guided', 'limited', 'full'));
```

| Phase | Duration | Tasks Created | Execution Mode | Daily Send Limit |
|-------|----------|---------------|----------------|------------------|
| **shadow** | Days 1-3 | Up to 10 | All `pending_review`. Even if gym is `limited_auto`, tasks are forced to review. | 0 — nothing sends. |
| **guided** | Days 4-7 | Up to 15 | All `pending_review`. Owner approves each one. System learns from approvals/rejections. | 3 |
| **limited** | Days 8-14 | Up to 25 | `limited_auto` allowed (confidence-gated). | 10 |
| **full** | Day 15+ | Normal limits | Whatever the gym's `execution_mode` is set to. | Normal `daily_send_limit`. |

```typescript
function getRampLimits(gym: Gym): RampLimits {
  const daysSinceOnboard = daysBetween(gym.onboarded_at, new Date())

  if (daysSinceOnboard <= 3) {
    return {
      phase: 'shadow',
      maxTasksPerDay: 10,
      dailySendLimit: 0,
      forceManualReview: true,
    }
  }
  if (daysSinceOnboard <= 7) {
    return {
      phase: 'guided',
      maxTasksPerDay: 15,
      dailySendLimit: 3,
      forceManualReview: true,
    }
  }
  if (daysSinceOnboard <= 14) {
    return {
      phase: 'limited',
      maxTasksPerDay: 25,
      dailySendLimit: 10,
      forceManualReview: false,
    }
  }
  return {
    phase: 'full',
    maxTasksPerDay: FLOOD_LIMITS.maxTasksPerGymPerDay,
    dailySendLimit: gym.daily_send_limit,
    forceManualReview: false,
  }
}
```

### 26.3 Shadow Phase: Learn Before Acting

During the shadow phase (days 1-3):
- Analysis runs normally — we want to show the owner what the system *would* do
- Tasks are created but all marked `pending_review`
- The dashboard shows: "We found 12 members who might need attention. Here's what we'd say."
- Nothing sends. The owner reviews drafts, approves or rejects, edits messages.
- The system logs which drafts the owner approved vs. rejected, building a signal for confidence calibration.

This is the "build trust" phase. The owner sees the AI's judgment without any risk.

### 26.4 Per-Agent Ramp

When a new agent or task type is enabled on a gym that's already past the `full` ramp phase, the NEW agent goes through its own mini-ramp:

```sql
CREATE TABLE agent_ramp_status (
  account_id UUID NOT NULL REFERENCES accounts(id),
  agent_type TEXT NOT NULL,
  enabled_at TIMESTAMPTZ DEFAULT NOW(),
  ramp_phase TEXT DEFAULT 'shadow',
  PRIMARY KEY (account_id, agent_type)
);
```

This way enabling "Sales Agent" on a gym that's been running "Retention Agent" for 6 months doesn't skip the trust-building phase for the new agent.

---

## 27. Dry Run and Plan Mode

### 27.1 Task Execution Modes

Every task can run in one of three execution modes:

```typescript
type TaskExecutionMode = 'live' | 'dry_run' | 'plan'
```

| Mode | What happens | Messages sent? | AI calls? | Shown in dashboard? |
|------|-------------|---------------|-----------|---------------------|
| **live** | Normal execution. Messages are sent. Outcomes tracked. | Yes | Yes | Yes |
| **dry_run** | Full pipeline runs but outbound actions are logged, not executed. The system does everything except actually send. | No — logged as "would have sent" | Yes | Yes, with "dry run" badge |
| **plan** | Agent produces a structured plan of what it would do, with draft messages and reasoning. Then stops and waits for owner review. | No | Yes (for planning) | Yes, as a reviewable plan |

### 27.2 Dry Run Mode

Dry run is for validation: "let me see what the system would do before I let it do it for real."

```typescript
// In the action executor, check execution mode:
if (task.execution_mode === 'dry_run' && profile.externalSideEffect) {
  await appendConversation(task.id, {
    role: 'system',
    content: `[DRY RUN] Would execute: ${action.type}`,
    metadata: { dryRun: true, actionType: action.type, params: action.params },
  })
  return { success: true, dryRun: true }
}
```

Dry run tasks go through the full state machine — `ready → executing → waiting → completed/cancelled`. They just don't actually send anything. This validates the entire pipeline including cadence timing, budget enforcement, and completion detection.

Use cases:
- Shadow phase tasks during onboarding
- Testing a new task type before enabling it
- Owner wants to preview what the system would do for a specific member

### 27.3 Plan Mode

Plan mode is for complex or sensitive tasks where the owner wants to approve the *strategy*, not just individual messages.

When a task runs in plan mode:

```typescript
interface TaskPlanStep {
  stepNumber: number
  actionType: ActionType
  description: string           // "Send personalized email about upcoming competition"
  draftContent?: string         // the actual message draft, if applicable
  reasoning: string             // why this step, why this order
  timing: string                // "immediately" | "day 3 if no reply" | "day 10 final touch"
  requiresApproval: boolean     // does owner need to approve this specific step?
  confidence: number
}

interface TaskPlan {
  taskId: string
  goal: string
  memberContext: string          // summary of what the agent knows
  steps: TaskPlanStep[]
  alternativeApproach?: string   // "if the member replies negatively, I would..."
  estimatedBudget: {
    messages: number
    days: number
    aiCalls: number
  }
}
```

The plan is stored in the task context and shown in the dashboard. The owner can:
1. **Approve the plan as-is** → task begins executing step by step
2. **Edit the plan** → modify draft messages, reorder steps, remove steps
3. **Give AI feedback** → type instructions like "don't mention the promotion, just check in" → agent regenerates the plan
4. **Reject** → cancel the task

Once approved, the task follows the plan but still evaluates after each step. If reality diverges from the plan (member replies unexpectedly), the agent adapts — the plan is a starting point, not a rigid script.

### 27.4 Owner Feedback on Plans and Outcomes

```sql
CREATE TABLE task_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_tasks(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  feedback_type TEXT NOT NULL,     -- 'plan_edit' | 'outcome_rating' | 'message_edit' | 'instruction'
  rating INT,                      -- 1-5 stars, or thumbs up (5) / down (1)
  comment TEXT,                    -- owner's note
  original_content TEXT,           -- what the AI produced
  edited_content TEXT,             -- what the owner changed it to (if applicable)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This feedback is gold. It tells us:
- Which drafts the owner rewrites (the AI's tone is wrong for this gym)
- Which task types get rejected most (the confidence threshold is too low)
- Which outcomes the owner disagrees with (our attribution is wrong)
- Patterns across gyms (if 80% of owners rewrite the churn_risk first touch, our prompt is bad)

### 27.5 Learning from Feedback (Future)

Eventually, per-gym feedback can tune confidence thresholds and prompt adjustments:

```
"This gym's owner has rejected 4 of 6 churn_risk plans with the note 'too formal'.
→ Adjust the gym profile vibe to 'casual_friendly'.
→ Lower the auto-threshold for this gym by 10 (more tasks go to review until we get it right)."
```

This is a future enhancement. For now, we collect the data and tune manually. But the table structure supports automated learning later.

---

## 28. Platform Observability

### 28.1 What We Need to Monitor

| Level | What | Why |
|-------|------|-----|
| **Per-task** | State transitions, AI decisions, budget usage | Debug individual task issues |
| **Per-gym** | Completion rate, escalation rate, owner engagement, attribution accuracy | Gym health score, churn risk for US |
| **Platform-wide** | Task volume, AI cost, send volume, error rates, feedback scores | Business health, cost control, quality |

### 28.2 Platform Metrics Table

```sql
CREATE TABLE platform_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id),  -- null = platform-wide metric
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  period TEXT NOT NULL,              -- 'daily' | 'weekly' | 'monthly'
  period_start TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(account_id, metric_name, period, period_start)
);
```

### 28.3 Key Metrics

**Task Pipeline Health** (computed daily by a metrics cron):

```typescript
interface DailyGymMetrics {
  // Volume
  tasksCreated: number
  tasksCompleted: number
  tasksCancelled: number
  tasksEscalated: number

  // Quality
  completionRate: number               // completed / (completed + cancelled + escalated)
  escalationRate: number               // escalated / total non-pending
  avgConfidenceAtCreation: number
  avgConfidenceAtCompletion: number

  // Attribution
  membersRetained: number              // tasks with attributed_value > 0
  revenueRetained: number              // sum of attributed_value
  verbalOnlyRate: number               // verbal_only outcomes / total engaged outcomes
  retroactiveAttributions: number      // late attributions (engaged_late)

  // AI Quality
  aiCallCount: number
  aiCostEstimate: number               // estimated $ based on token counts
  ownerEditRate: number                // % of drafts the owner edited before approving
  ownerRejectRate: number              // % of tasks rejected/skipped in review
  thumbsUpRate: number                 // positive outcome ratings / total ratings

  // Engagement
  ownerResponseTime: number            // avg time from escalation to owner action (minutes)
  memberReplyRate: number              // % of outbound messages that got a reply
  avgConversationTurns: number
}
```

**Platform-Wide Aggregates:**

```typescript
interface PlatformMetrics {
  activeGyms: number
  totalTasksToday: number
  totalMessagesSent: number
  totalAiCost: number
  avgCompletionRate: number           // across all gyms
  avgRetainedPerGym: number           // members retained per gym per month
  worstPerformingTaskType: string     // lowest completion rate
  bestPerformingTaskType: string      // highest completion rate
  gymsNeedingAttention: string[]      // gyms with high escalation rate or low owner engagement
}
```

### 28.4 Alerting

Conditions that trigger alerts to US (the company):

| Condition | Severity | Action |
|-----------|----------|--------|
| Gym's escalation rate > 50% for 3+ days | Warning | Check if their confidence thresholds are too low |
| Gym's owner hasn't responded to escalations in 48+ hours | Warning | Check if owner has disengaged |
| AI cost for a gym exceeds $10/day | Warning | Check for runaway tasks |
| Member reply contains "lawsuit", "attorney", "BBB" | Critical | Immediate review — suppress member, notify us |
| Global error rate > 5% on task transitions | Critical | Something is broken in the pipeline |
| A gym has 0 completed tasks after 14 days | Info | Onboarding may have stalled |
| `verbal_only` outcome rate > 60% for a task type | Info | Our attribution may be too generous |

### 28.5 Owner Outcome Rating

In the dashboard, completed and escalated tasks have a feedback mechanism:

```
┌────────────────────────────────────────────┐
│ ✓ Alex M. — retained after outreach        │
│   Checked in 3 days after our email.       │
│   Attributed: $150/mo                      │
│                                            │
│   Was this accurate?  👍  👎               │
│   [Optional note: ___________________]     │
└────────────────────────────────────────────┘
```

Thumbs down opens a dropdown: "Never came back" / "Would have come back anyway" / "Wrong member" / "Other". This feeds into `task_feedback` and lets us measure attribution honesty.

---

## 29. Timezone-Aware Scheduling

### 29.1 Gym Timezone

Every gym has a timezone (from §23.1):

```sql
timezone TEXT DEFAULT 'America/New_York'
send_window_start INT DEFAULT 8    -- 8am local
send_window_end INT DEFAULT 20     -- 8pm local
```

### 29.2 Send Window Enforcement

Before executing any outbound action, the system checks if we're inside the gym's send window:

```typescript
function isInSendWindow(gym: Gym): { inWindow: boolean; nextWindowAt?: Date } {
  const now = new Date()
  const localHour = getLocalHour(now, gym.timezone)  // e.g., 14 for 2pm

  if (localHour >= gym.send_window_start && localHour < gym.send_window_end) {
    return { inWindow: true }
  }

  // Calculate when the next window opens
  const nextWindow = getNextWindowOpen(now, gym.timezone, gym.send_window_start)
  return { inWindow: false, nextWindowAt: nextWindow }
}
```

Enforced in the task executor:

```typescript
// Before sending any message:
const window = isInSendWindow(gym)
if (!window.inWindow) {
  // Don't send now. Delay until the window opens.
  await updateTask(task.id, {
    next_action_at: window.nextWindowAt.toISOString(),
  })
  await appendConversation(task.id, {
    role: 'system',
    content: `Message delayed: outside send window (${gym.send_window_start}:00-${gym.send_window_end}:00 ${gym.timezone}). Scheduled for ${window.nextWindowAt.toISOString()}.`,
  })
  return
}
```

### 29.3 Smart Timing

Beyond just "inside the window," we can optimize send times:

- **Avoid exact hour marks** — emails sent at exactly 8:00 AM feel automated. Add 5-20 minutes of jitter.
- **Prefer morning for initial outreach** — first touches are more effective early in the day.
- **Prefer afternoon for follow-ups** — follow-ups later in the day feel less aggressive.

```typescript
function getOptimalSendTime(gym: Gym, touchIndex: number): Date {
  const now = new Date()
  const localHour = getLocalHour(now, gym.timezone)

  // If we're in the window and the time is appropriate, send now (with jitter)
  const jitterMinutes = Math.floor(Math.random() * 15) + 5  // 5-20 min jitter

  // Initial outreach: prefer 8-10am
  if (touchIndex === 0 && localHour >= gym.send_window_start && localHour < 10) {
    return addMinutes(now, jitterMinutes)
  }

  // Follow-ups: prefer 1-4pm
  if (touchIndex > 0 && localHour >= 13 && localHour < 16) {
    return addMinutes(now, jitterMinutes)
  }

  // If current time isn't ideal, schedule for the preferred window
  if (touchIndex === 0) {
    return getNextTime(gym.timezone, 8, jitterMinutes)  // tomorrow 8am + jitter
  } else {
    return getNextTime(gym.timezone, 13, jitterMinutes)  // tomorrow 1pm + jitter
  }
}
```

---

## 30. Member Data Freshness

### 30.1 The Problem

A task is created on Monday with `context: { lastCheckin: '18 days ago', riskLevel: 'high' }`. It sits in `pending_review` until Wednesday. The owner approves it. But between Monday and Wednesday, the member checked in twice — the context is stale, and the message ("we haven't seen you in a while!") would be embarrassing and wrong.

### 30.2 Stale Guard

Before executing any task, the system refreshes key member data and re-evaluates whether the task is still relevant:

```typescript
async function staleGuard(task: AgentTask): Promise<{ proceed: boolean; reason?: string }> {
  // Only applies to tasks with a member_id (can fetch from PushPress)
  if (!task.member_id) return { proceed: true }

  const contextAge = Date.now() - new Date(task.last_activity_at ?? task.created_at).getTime()
  const MAX_CONTEXT_AGE_MS = 4 * 60 * 60 * 1000  // 4 hours

  // If context is fresh enough, proceed
  if (contextAge < MAX_CONTEXT_AGE_MS) return { proceed: true }

  // Refresh member data from PushPress
  const freshData = await pushpress.getCustomer(task.member_id)
  if (!freshData) return { proceed: true }  // API failed — proceed with stale data

  // Check if the task is still relevant
  const checks = {
    // Member checked in recently — churn/risk task may no longer be needed
    recentCheckin: freshData.lastCheckinAt &&
      daysBetween(new Date(freshData.lastCheckinAt), new Date()) < 3,

    // Member status changed — e.g., cancelled, frozen, or reactivated
    statusChanged: freshData.status !== task.context?.memberStatus,

    // Payment resolved — payment_recovery task may no longer be needed
    paymentResolved: task.task_type === 'payment_recovery' &&
      freshData.paymentStatus === 'current',

    // Member is now suppressed
    suppressed: await isMemberSuppressed(task.member_email, task.account_id),
  }

  // Update task context with fresh data regardless
  await supabaseAdmin
    .from('agent_tasks')
    .update({
      context: {
        ...task.context,
        memberStatus: freshData.status,
        lastCheckin: freshData.lastCheckinAt,
        paymentStatus: freshData.paymentStatus,
        contextRefreshedAt: new Date().toISOString(),
      },
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', task.id)

  // If the situation resolved itself, complete the task
  if (checks.recentCheckin && ['churn_risk', 'win_back'].includes(task.task_type)) {
    await transitionTask(task.id, 'completed', {
      outcome: 'self_resolved',
      outcome_reason: 'member_checked_in_before_outreach',
    })
    return { proceed: false, reason: 'self_resolved' }
  }

  if (checks.paymentResolved) {
    await transitionTask(task.id, 'completed', {
      outcome: 'self_resolved',
      outcome_reason: 'payment_resolved_before_outreach',
    })
    return { proceed: false, reason: 'payment_resolved' }
  }

  if (checks.suppressed) {
    await transitionTask(task.id, 'cancelled', {
      outcome_reason: 'member_opted_out',
    })
    return { proceed: false, reason: 'member_opted_out' }
  }

  // If status changed but task is still relevant, inject fresh context
  // so the AI drafts with accurate information
  if (checks.statusChanged) {
    await appendConversation(task.id, {
      role: 'system',
      content: `Member status updated: was ${task.context?.memberStatus}, now ${freshData.status}. Context refreshed.`,
    })
  }

  return { proceed: true }
}
```

### 30.3 When the Stale Guard Runs

Integrated into the task executor:

```typescript
async function executeTask(task: AgentTask) {
  // ── Step 0: Stale guard ──
  const freshCheck = await staleGuard(task)
  if (!freshCheck.proceed) {
    console.log(`[executor] Task ${task.id} no longer relevant: ${freshCheck.reason}`)
    return
  }

  // ── Step 1: Safety checks (member rate limit, daily limit, etc.) ──
  // ... existing logic ...
}
```

This means: a task can sit in `pending_review` for days, get approved, and the moment it's about to execute, the system double-checks that it's still needed. If the member came back on their own — the task completes with `outcome: 'self_resolved'` and the system moves on.

---

## 31. Task Categories: Beyond Communication

The spec so far is built around communication tasks (email someone, wait for reply, follow up). But a gym's needs include many non-communication tasks. The system needs to handle all of them without special-casing each one.

### 31.1 The Five Task Categories

| Category | Executor | Completion Signal | Example |
|----------|----------|-------------------|---------|
| **Communication** | AI agent sends message, handles conversation | Member reply, checkin, reactivation | Churn outreach, win-back, lead nurture |
| **Staff To-Do** | Assigned to a human (owner, coach, front desk). System tracks, nudges, but doesn't execute. | Human marks it done, or system detects outcome. | "Call Sarah", "Clean the rig", "Order new bands" |
| **Research** | AI gathers data, produces a deliverable (report, summary, member profile) | Deliverable is produced and stored. | "Build Sarah's member profile", "Analyze this month's churn patterns" |
| **Automation** | System executes API calls or internal operations. No human or AI conversation. | API returns success. | "Tag all at-risk members", "Update Sarah's notes in PushPress" |
| **Recurring** | Template that spawns a new task on a schedule. | Each instance completes individually. | "Weekly class reminder", "Monthly coach briefing", "Daily at-risk scan" |

### 31.2 What Changes Per Category

The state machine (§3) works for ALL categories. The differences are in execution:

```typescript
// Addition to TaskTypeDef
export interface TaskTypeDef {
  // ... existing fields ...
  category: 'communication' | 'staff_todo' | 'research' | 'automation' | 'recurring'
  assignmentType: 'agent' | 'owner' | 'coach' | 'staff' | 'system'  // who executes this?
  deliverableType?: 'none' | 'report' | 'plan' | 'member_profile' | 'data_export'
  recurrence?: {
    cron: string          // cron expression: '0 8 * * 1' (Mondays at 8am)
    maxInstances: number  // safety: don't create more than N instances
  }
}
```

### 31.3 Staff To-Do Tasks

These are tasks the AI can't do — they require a human at the gym. "Call this member", "Follow up on that equipment order", "Prepare for Sarah's return visit."

```typescript
staff_call_member: {
  type: 'staff_call_member',
  label: 'Call Member',
  category: 'staff_todo',
  assignmentType: 'owner',           // or 'coach' with a specific assignee
  agent: 'gm',                       // GM agent creates these, but doesn't execute them
  priority: 'high',
  budget: { maxMessages: 0, maxDays: 3, maxTurns: 0 },  // no AI messages, just a timer
  followUp: {
    intervals: [1, 2],               // nudge owner after 1 day, then 2 days
    toneProgression: ['reminder', 'urgent_reminder'],
    onExhaustion: 'escalate',        // if owner ignores for 3 days, flag it
  },
  autoThreshold: 0,                  // always surfaces in review queue
  escalationTriggers: ['always'],
  systemPrompt: '',                  // no AI drafting — this is a human task
  outcomeSignals: ['checkin', 'reply_positive'],  // if member checks in, task worked
  deliverableType: 'none',
}
```

**How staff to-dos flow through the pipeline:**

1. **Created** by the AI agent ("I think someone should call Sarah — her situation is too nuanced for email")
2. **Shown in the review queue** as a to-do card, not a message approval card. The card says: "Call Sarah M. — hasn't responded to 2 emails, seems uncertain about returning. Here's the context: [...]"
3. **Owner accepts** → task moves to `executing`. But the executor sees `category: 'staff_todo'` and `assignmentType: 'owner'`, so it doesn't send a message — it just starts the timer.
4. **Nudge reminders** fire via the follow-up cadence (§5.1). These are `notify_owner` actions, not member-facing messages. "Reminder: you still need to call Sarah M."
5. **Completion**: either the owner clicks "Done" in the dashboard, or the system detects a checkin from Sarah (outcome signal). If the owner ignores the task for 3 days, it escalates — a persistent notification.

```typescript
// In the task executor:
if (typeDef.category === 'staff_todo') {
  // Don't execute an AI action. Start the reminder cadence.
  await transitionTask(task.id, 'waiting', {
    execution_started_at: new Date().toISOString(),
    next_action_at: addDays(new Date(), typeDef.followUp.intervals[0]).toISOString(),
  })
  await notifyAssignee(task)  // push/email to the assigned person
  return
}
```

### 31.4 Research Tasks

Research tasks produce a **deliverable** — a structured output that other tasks or the dashboard can consume.

```typescript
interface TaskDeliverable {
  type: 'report' | 'plan' | 'member_profile' | 'data_export'
  title: string
  content: string          // markdown or structured text
  data?: Record<string, unknown>  // structured data for programmatic use
  createdAt: string
}
```

```sql
-- Additions to agent_tasks
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS deliverable JSONB;  -- TaskDeliverable, null for non-research tasks
```

Example: the GM agent is asked "analyze my churn patterns this month." It creates a research task:

```typescript
monthly_churn_analysis: {
  type: 'monthly_churn_analysis',
  label: 'Monthly Churn Analysis',
  category: 'research',
  assignmentType: 'agent',
  agent: 'gm',
  priority: 'low',
  budget: { maxMessages: 0, maxDays: 1, maxTurns: 5 },  // no messages, just AI reasoning
  followUp: CADENCES.single_shot,
  autoThreshold: 95,   // research is safe to auto-run
  escalationTriggers: [],
  systemPrompt: `Analyze this gym's member data and produce a churn report...`,
  outcomeSignals: [],   // no external outcome — the deliverable IS the outcome
  deliverableType: 'report',
}
```

**Research task flow:**
1. Agent gathers data (PushPress API, existing task history, member records)
2. Agent produces a deliverable (structured report)
3. Deliverable is stored in `task.deliverable`
4. Task completes immediately — no conversation, no follow-up
5. The deliverable is shown in the dashboard and can be referenced by future tasks

**How other tasks consume research output:**

When an agent plans a complex task, it can create a `research_member` subtask first. The subtask produces a deliverable (member profile). The parent task's agent then reads that deliverable from the subtask's context when planning its next step. No special plumbing needed — the subtask's `deliverable` field is available via `getTask(subtaskId)`.

### 31.5 Automation Tasks

Pure system operations — no AI conversation, no human assignment. Tag a member, update notes, sync data.

```typescript
bulk_tag_at_risk: {
  type: 'bulk_tag_at_risk',
  label: 'Tag At-Risk Members',
  category: 'automation',
  assignmentType: 'system',
  agent: 'gm',
  priority: 'low',
  budget: { maxMessages: 0, maxDays: 1, maxTurns: 0 },
  followUp: CADENCES.single_shot,
  autoThreshold: 95,
  escalationTriggers: [],
  systemPrompt: '',
  outcomeSignals: [],
  deliverableType: 'none',
}
```

**Automation tasks and batch operations:**

A batch operation ("tag all 50 at-risk members") is NOT 50 subtasks. It's a single automation task that makes 50 API calls internally. The 8-subtask limit (§7.8) is for agent *planning* steps, not for a known operation that happens to touch multiple records.

```typescript
// Automation tasks have a different executor path:
if (typeDef.category === 'automation') {
  const handler = AUTOMATION_HANDLERS[task.task_type]
  if (!handler) {
    await transitionTask(task.id, 'escalated', { reason: 'no_handler_for_automation_type' })
    return
  }

  try {
    const result = await handler(task)
    await transitionTask(task.id, 'completed', {
      outcome: 'executed',
      outcome_reason: `Completed: ${result.summary}`,
    })
    if (result.deliverable) {
      await updateTask(task.id, { deliverable: result.deliverable })
    }
  } catch (err) {
    await transitionTask(task.id, 'escalated', {
      reason: `Automation failed: ${err.message}`,
    })
  }
  return
}
```

Batch API calls within an automation task still have safety rails:
- Rate-limited to PushPress API limits (not our task limits — those are for member-facing actions)
- Logged individually so we can audit what changed
- Reversible operations store the previous state so we can undo if needed

### 31.6 Recurring Tasks

A recurring task is a **template** that spawns fresh task instances on a schedule. The template itself is never executed — it's a factory.

```sql
CREATE TABLE recurring_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  task_type TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  cron_expression TEXT NOT NULL,      -- '0 8 * * 1' = Mondays at 8am
  max_instances INT DEFAULT 52,       -- safety: max 52 instances (1 year of weekly)
  instances_created INT DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  next_trigger_at TIMESTAMPTZ,
  template_context JSONB,             -- default context injected into each instance
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

The cron job checks for due templates and spawns instances:

```typescript
// In the task-executor cron
async function triggerRecurringTemplates() {
  const { data: due } = await supabaseAdmin
    .from('recurring_task_templates')
    .select('*')
    .eq('enabled', true)
    .lt('next_trigger_at', new Date().toISOString())

  for (const template of due ?? []) {
    if (template.instances_created >= template.max_instances) {
      // Safety: disable the template
      await supabaseAdmin
        .from('recurring_task_templates')
        .update({ enabled: false })
        .eq('id', template.id)
      continue
    }

    await createTask({
      accountId: template.account_id,
      taskType: template.task_type,
      triggerType: 'recurring',
      triggerEventId: template.id,
      context: template.template_context,
      goal: `Recurring: ${template.task_type}`,
    })

    // Schedule next trigger
    const next = getNextCronTime(template.cron_expression)
    await supabaseAdmin
      .from('recurring_task_templates')
      .update({
        instances_created: template.instances_created + 1,
        last_triggered_at: new Date().toISOString(),
        next_trigger_at: next.toISOString(),
      })
      .eq('id', template.id)
  }
}
```

Each spawned instance is a normal task — goes through the full pipeline with its own budget, state machine, etc.

### 31.7 Multi-Member Tasks

Some tasks target multiple members at once: "Send class reminder to everyone booked for tomorrow's 6am", "Congratulate everyone who hit 100 visits this month."

These are NOT modeled as one task with many targets. They're modeled as a **parent task** (the goal) with **one subtask per member** (the execution). But this hits the 8-subtask limit from §7.8.

**Solution: batch subtasks have a higher limit.**

```typescript
const SUBTASK_LIMITS = {
  maxSubtasksPerParent: 8,            // for agent-planned decomposition
  maxBatchSubtasksPerParent: 50,      // for known batch operations (class reminder, etc.)
  maxSubtaskDepth: 2,
  maxSubtasksPerEvaluation: 2,
}
```

The difference: agent-planned subtasks (where the AI decides what steps to take) are capped at 8 because we don't trust unbounded AI planning. Batch subtasks (where the code knows exactly what to do for each member) can go higher because the operation is deterministic.

```typescript
if (input.batchOperation) {
  // Batch: higher limit, but each subtask still goes through safety rails individually
  maxAllowed = SUBTASK_LIMITS.maxBatchSubtasksPerParent
} else {
  // Agent-planned: tight limit
  maxAllowed = SUBTASK_LIMITS.maxSubtasksPerParent
}
```

Each batch subtask is still a real task — it has its own member, goes through the member coordinator (§21), respects rate limits, and can be individually approved/skipped. The parent task tracks aggregate completion ("23/30 class reminders sent, 5 deferred due to rate limits, 2 members suppressed").

---

## 32. Idempotency

### 32.1 The Problem

Every external trigger can fire more than once:
- Webhooks can be delivered twice (PushPress, Resend both document this)
- The cron can process the same task in consecutive ticks if the first run was slow
- The owner can double-click "Approve" before the UI disables the button
- Network retries can duplicate API calls

Without idempotency, the same email gets sent twice. That's embarrassing at best, harmful at worst.

### 32.2 Idempotency Keys

Every outbound action gets an idempotency key. The action executor checks if an action with this key has already been executed.

```sql
ALTER TABLE outbound_messages
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- For non-email actions:
CREATE TABLE action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_tasks(id),
  action_type TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  params JSONB,
  result JSONB,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
```

The key is derived from the task ID + action type + touch index (for follow-ups):

```typescript
function makeIdempotencyKey(taskId: string, actionType: string, touchIndex: number): string {
  return `${taskId}:${actionType}:${touchIndex}`
}

// Before executing any action:
async function executeAction(task, action) {
  const key = makeIdempotencyKey(task.id, action.type, task.followup_touch_index)

  const existing = await supabaseAdmin
    .from('action_log')
    .select('id')
    .eq('idempotency_key', key)
    .single()

  if (existing.data) {
    // Already executed. Skip silently.
    return { success: true, deduplicated: true }
  }

  // Execute, then log with the key
  const result = await handler(task, action.params)
  await supabaseAdmin.from('action_log').insert({
    task_id: task.id,
    action_type: action.type,
    idempotency_key: key,
    params: action.params,
    result,
  })

  return { success: true, data: result }
}
```

### 32.3 Webhook Deduplication

PushPress and Resend webhooks include event IDs. We store them and skip duplicates:

```sql
CREATE TABLE processed_webhooks (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,         -- 'pushpress' | 'resend'
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

```typescript
async function handleWebhook(source: string, eventId: string, payload: unknown) {
  // Skip if already processed
  const { error } = await supabaseAdmin
    .from('processed_webhooks')
    .insert({ event_id: eventId, source })

  if (error?.code === '23505') {  // unique violation
    console.log(`[webhook] Duplicate ${source} event: ${eventId}. Skipping.`)
    return
  }

  // Process normally
  await processWebhookPayload(source, payload)
}
```

---

## 33. Email Deliverability

If emails go to spam, the entire system is worthless. This isn't a feature — it's a prerequisite.

### 33.1 Sending Identity

Emails are sent from one of two configurations:

**Option A: Our shared domain (default for new gyms)**
- From: `CrossFit Renegade <outreach@mail.gymagents.com>`
- We control SPF/DKIM/DMARC
- Lower deliverability (shared reputation) but zero setup for the gym

**Option B: Gym's custom domain (recommended)**
- From: `Coach Mike <mike@crossfitrenegade.com>`
- Requires gym to add DNS records (SPF include, DKIM CNAME)
- Higher deliverability (their own reputation) but requires setup
- Resend supports custom domains with verified DNS

```sql
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS sending_domain TEXT,             -- null = shared, or 'crossfitrenegade.com'
  ADD COLUMN IF NOT EXISTS sending_domain_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS from_name TEXT,                   -- 'Coach Mike' or 'CrossFit Renegade'
  ADD COLUMN IF NOT EXISTS from_email TEXT;                  -- 'mike@crossfitrenegade.com'
```

### 33.2 Warm-Up

When a gym starts sending, we don't blast 15 emails day 1. The onboarding ramp (§26) already handles this — but deliverability warm-up is even more conservative:

| Week | Max sends/day | Notes |
|------|---------------|-------|
| 1 | 3 | Shadow + guided phase. Most are dry runs anyway. |
| 2 | 5 | Start sending real messages. Monitor bounces. |
| 3 | 10 | If bounce rate < 5%, increase. |
| 4+ | 15 (full) | Full sending capacity. |

If bounce rate exceeds 10% at any point: auto-pause sending, alert us. Bad bounce rates tank domain reputation fast.

### 33.3 Bounce and Complaint Handling

Resend sends webhooks for bounces and complaints. These feed into the suppression system:

```typescript
async function handleResendEvent(event: ResendEvent) {
  switch (event.type) {
    case 'email.bounced':
      // Hard bounce: suppress the member (bad email address)
      if (event.bounce_type === 'hard') {
        await suppressMember(event.recipient, accountId, 'hard_bounce', 'resend_webhook')
      }
      // Soft bounce: log it, retry later. 3 soft bounces = treat as hard.
      break

    case 'email.complained':
      // Spam complaint: suppress immediately, notify us
      await suppressMember(event.recipient, accountId, 'complaint', 'resend_webhook')
      await alertPlatform('spam_complaint', { accountId, memberEmail: event.recipient })
      break
  }
}
```

### 33.4 Unsubscribe Headers

Every email includes both:
- `List-Unsubscribe` header (one-click unsubscribe for email clients)
- Visible unsubscribe link in the footer

```typescript
headers: {
  'List-Unsubscribe': `<https://app.gymagents.com/api/unsubscribe?token=${jwt}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
}
```

This is required by Gmail and Yahoo as of Feb 2024 for bulk senders.

---

## 34. PushPress API Dependency and Graceful Degradation

### 34.1 The Risk

The system depends on PushPress for: member data, checkin events, payment status, tags, and status changes. If PushPress is down:
- Stale guard (§30) can't refresh member data
- Attribution cron (§9) can't check for checkins
- Automation tasks can't tag members
- Webhook-triggered tasks stop arriving

### 34.2 Degradation Strategy

```typescript
interface PushPressHealth {
  status: 'healthy' | 'degraded' | 'down'
  lastSuccessfulCall: Date
  consecutiveFailures: number
}

async function callPushPress<T>(fn: () => Promise<T>, fallback?: T): Promise<T | null> {
  try {
    const result = await fn()
    await resetPushPressHealth()
    return result
  } catch (err) {
    await incrementPushPressFailure()
    const health = await getPushPressHealth()

    if (health.consecutiveFailures >= 5) {
      // PushPress is down. Don't keep hammering it.
      await logEvent('pushpress_degraded', {
        failures: health.consecutiveFailures,
        lastSuccess: health.lastSuccessfulCall,
      })
    }

    return fallback ?? null
  }
}
```

**What still works when PushPress is down:**
- Conversation loops (member replies to email → AI evaluates → replies)
- Owner approvals and escalation handling
- Task state machine and budget enforcement
- Email sending via Resend

**What pauses:**
- New task creation from analysis (can't fetch member data) → cron skips, logs, tries next run
- Stale guard (§30) → proceeds with stale data, adds a warning to task context
- Automation tasks (tag/update) → deferred, retried next tick
- Attribution (§9) → skips, runs next cycle

**Key principle:** PushPress being down should never cause a wrong email to be sent. The worst case is: tasks are delayed until PushPress recovers. Communication that's already in-flight (conversation loops) continues because it doesn't depend on PushPress.

---

## 35. Owner Notification Budget

### 35.1 The Problem

The system can notify the owner via: escalations, nudge reminders for staff to-dos, daily digest, ramp-up activity, onboarding prompts, AI cost warnings, stale escalation reminders, and feedback requests. Without a cap, the owner gets 30 notifications a day and starts ignoring all of them.

### 35.2 Notification Priority and Throttling

```typescript
type NotificationType =
  | 'escalation'          // task needs human input — always delivered
  | 'approval_needed'     // task awaiting review — batched
  | 'staff_todo_nudge'    // reminder for a human task — max 2/day
  | 'outcome_feedback'    // "was this accurate?" — max 3/day
  | 'system_alert'        // cost warning, error — always delivered
  | 'daily_digest'        // once a day
  | 'ramp_activity'       // during onboarding — max 1/day

const NOTIFICATION_LIMITS: Record<NotificationType, { maxPerDay: number; batchable: boolean }> = {
  escalation:        { maxPerDay: Infinity, batchable: false },  // always deliver, never suppress
  approval_needed:   { maxPerDay: 5,        batchable: true },   // batch into "5 tasks need review"
  staff_todo_nudge:  { maxPerDay: 2,        batchable: true },
  outcome_feedback:  { maxPerDay: 3,        batchable: true },
  system_alert:      { maxPerDay: Infinity, batchable: false },
  daily_digest:      { maxPerDay: 1,        batchable: false },
  ramp_activity:     { maxPerDay: 1,        batchable: true },
}
```

Batchable notifications are grouped: instead of 5 separate "task needs review" emails, the owner gets one email: "5 tasks need your review." Sent at most every 4 hours during the gym's send window.

### 35.3 Notification Channels

```sql
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS owner_notification_channel TEXT DEFAULT 'email'
    CHECK (owner_notification_channel IN ('email', 'dashboard_only', 'email_and_sms'));
```

- `email`: everything goes to owner's email (default)
- `dashboard_only`: only show in the dashboard, no push. For owners who check the app regularly.
- `email_and_sms`: critical escalations also get SMS. For owners who need immediate alerts.

---

## 36. Task Type Skill Files

### 36.1 Why Skill Files

Each task type needs detailed instructions for the AI: how to approach the member, what tone to use, what to avoid, how to handle common situations, what signals to look for. An inline `systemPrompt` string can't hold all of this. It also can't be versioned, tested, or reviewed independently.

Every task type gets a **skill file** — a markdown document that serves as the AI's instruction manual for that type of work.

### 36.2 Skill File Structure

```
lib/task-skills/
├── churn-risk.md
├── win-back.md
├── lead-followup.md
├── payment-recovery.md
├── onboarding.md
├── staff-call-member.md
├── monthly-churn-analysis.md
├── ad-hoc.md
└── _base.md                  # shared instructions inherited by all task types
```

Each skill file follows a standard structure:

```markdown
# Churn Risk — Task Skill

## Role
You are acting as {gym.profile.displayName}'s personal outreach coordinator.
You're reaching out to a member who hasn't been in recently.

## Goal
{goal.summary}

## Context You'll Receive
- Member name, email, last checkin date, membership tenure
- Risk score and factors (from analysis)
- Any previous conversations with this member
- Other active tasks for this member (cross-task context from §21)

## Approach by Touch

### Touch 1: Friendly Check-In
- Tone: warm, personal, zero pressure
- DO: mention something specific (their usual class time, how long they've been a member)
- DO: ask an open-ended question ("everything okay?")
- DON'T: mention that they haven't been coming (they know)
- DON'T: offer discounts or incentives (feels transactional)
- Length: 3-4 sentences max

### Touch 2: Direct but Caring
- Tone: slightly more direct, acknowledge the gap
- DO: reference the first email naturally ("I reached out last week")
- DO: offer to help with anything specific (schedule change, class recommendation)
- DON'T: guilt-trip
- Length: 3-4 sentences

### Touch 3: Open Door
- Tone: low-pressure final note
- DO: make it clear there's no obligation
- DO: leave something specific to come back to ("we just started a new Saturday class")
- DO: explicitly say "no need to reply if now isn't the right time"
- Length: 2-3 sentences

## Handling Replies

### Positive reply ("I'll come in this week!")
- Thank them warmly
- If they mentioned a specific day/class, reference it
- Evaluate as: `verbal_commitment` (confidence 65-75)
- Do NOT mark as `retained` until a checkin signal is detected

### Vague reply ("yeah maybe", "been busy")
- Acknowledge without pushing
- Ask ONE specific question to help: "Would mornings or evenings work better?"
- Evaluate as: `engaged_conversation` (confidence 40-55)
- Action: `wait` for their response

### Negative reply ("I'm cancelling", "not interested")
- Respect their decision immediately
- Do NOT try to convince them
- If they mention a specific complaint, note it for the owner
- Evaluate as: `churned` or `opted_out`
- Action: `close` or `escalate` (if complaint)

### Question you can't answer
- "What are your hours?" / "Can I freeze?" / "Do you have childcare?"
- Action: `escalate` with the specific question
- Do NOT guess or make up information

### Hostile / angry
- Do NOT respond
- Action: `escalate` immediately
- Set `suggestSuppression: true`

## Common Mistakes to Avoid
- Don't use the member's last name in casual outreach (too formal)
- Don't say "we noticed you haven't been in" (surveillance-y)
- Don't send at-risk outreach to someone who checked in yesterday (stale guard should catch this, but double-check context)
- Don't offer the same thing in Touch 2 that you offered in Touch 1
- Don't end with "Let me know!" (passive, easily ignored) — end with a question

## Evaluation Criteria
When evaluating if the goal is achieved:
- A checkin within 14 days = `retained` (concrete signal)
- "I'll come in Tuesday" = `verbal_commitment` (specific day = higher confidence)
- "Yeah I should come back" = `engaged_conversation` (vague = lower confidence)
- No reply after all touches = `unresponsive`
```

### 36.3 How Skill Files Are Loaded

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const SKILL_CACHE = new Map<string, string>()

function loadSkillFile(skillPath: string): string | null {
  if (SKILL_CACHE.has(skillPath)) return SKILL_CACHE.get(skillPath)!

  const fullPath = join(process.cwd(), skillPath)
  if (!existsSync(fullPath)) return null

  const content = readFileSync(fullPath, 'utf-8')
  SKILL_CACHE.set(skillPath, content)
  return content
}

function getBaseSkill(): string {
  return loadSkillFile('lib/task-skills/_base.md') ?? ''
}

/**
 * Build the complete system prompt for a task execution.
 * Layers: base skill → task type skill → gym context → gym overrides
 */
function buildSystemPrompt(gym: Gym, typeDef: TaskTypeDef, task: AgentTask): string {
  const layers: string[] = []

  // Layer 1: Base skill (shared rules for all task types)
  layers.push(getBaseSkill())

  // Layer 2: Task type skill file
  const typeSkill = loadSkillFile(typeDef.skillFile)
  if (typeSkill) {
    layers.push(typeSkill)
  } else if (typeDef.systemPrompt) {
    // Fallback to inline prompt (deprecated, for migration)
    layers.push(typeDef.systemPrompt)
  }

  // Layer 3: Gym context (from §23)
  layers.push(buildGymContextPrompt(gym))

  // Layer 4: Gym-specific overrides (from §23.3 account_agent_configs)
  const override = getGymPromptOverride(gym.id, typeDef.agent, typeDef.type)
  if (override) layers.push(override)

  // Layer 5: Goal evaluation criteria (from the goal definition)
  layers.push(buildGoalPrompt(typeDef.goal, typeDef.goal.outcomes))

  // Layer 6: Cross-task context for this member (from §21)
  if (task.member_email) {
    const crossTaskContext = buildCrossTaskContext(task)
    if (crossTaskContext) layers.push(crossTaskContext)
  }

  return layers.join('\n\n---\n\n')
}
```

### 36.4 The Base Skill File (_base.md)

Every task type inherits from `_base.md`:

```markdown
# Base Instructions — All Task Types

## Identity
You are an AI assistant acting on behalf of a gym. You are NOT the gym owner —
you are a tool helping them communicate. Never claim to be the owner unless
the gym profile's signOff indicates otherwise.

## Hard Rules (never violate these)
1. Never invent information about the gym (classes, hours, prices, policies)
2. Never make promises on behalf of the gym (discounts, schedule changes, exceptions)
3. Never mention other members by name
4. Never reveal that you are an AI unless directly asked
5. Never send a message you aren't confident in — escalate instead
6. Every email must sound like it came from a real person at the gym

## When in Doubt
If you're unsure about ANYTHING — the right tone, whether the information is
accurate, whether the member's situation warrants outreach, whether your reply
is appropriate — choose action: 'escalate'. It is ALWAYS better to ask the
gym owner than to guess wrong.

## Message Quality
- Short: 2-5 sentences for outreach, 1-3 for replies
- Natural: contractions, casual grammar, no corporate speak
- Personal: use their first name, reference something specific to them
- No formatting: plain text, no bullet points, no bold, no HTML styling
- No emojis unless the gym's vibe is explicitly 'casual_friendly'
```

### 36.5 Adding a New Task Type Checklist

To add a new task type, a developer does:

1. **Define the type** in `lib/task-types.ts` — fills out the `TaskTypeDef` contract (identity, goal, budget, cadence, safety, outcomes)
2. **Write the skill file** in `lib/task-skills/{type}.md` — detailed instructions, per-touch approach, reply handling, evaluation criteria
3. **Add a trigger** — webhook handler, cron condition, or GM agent logic that creates instances of this task type
4. **That's it.** The pipeline (execution, safety rails, completion, attribution, dashboard display) all work automatically because the contract is complete.

If the skill file is missing, the system falls back to the inline `systemPrompt`. If that's also missing, the task escalates immediately — it's safer to ask the owner than to execute with no instructions.

### 36.6 Infinite Task Types by Design

The task type system is explicitly architected to support an **unbounded number of task types**. There is no cap.

**Why this works without becoming chaos:**

1. **The contract is the guardrail.** Every task type must fill out the same `TaskTypeDef` interface (§5). The pipeline doesn't care if there are 8 types or 800 — it reads the contract and executes accordingly. Budget, cadence, safety thresholds, goal definition, skill file — all defined upfront.

2. **The pipeline is generic.** The state machine (§3), execution loop (§6), safety rails (§7), attribution (§10), and dashboard display all operate on the `TaskTypeDef` contract, not on hardcoded type names. Adding a new task type doesn't require touching the pipeline.

3. **Skill files are the specialization layer.** The pipeline handles lifecycle; the skill file handles domain knowledge. A "birthday outreach" task and a "referral request" task use the same state machine, the same safety rails, the same follow-up cadence system — they just have different skill files telling the AI what to say and how to evaluate replies.

4. **Unknown types fail safely.** Any task with an unrecognized `type` falls back to `ad_hoc`, which requires human review for everything. This means a misconfigured task type can't run unsupervised.

5. **No database migration needed.** Task types live in the TypeScript registry (`TASK_TYPES`), not in a database table. Adding a new type is a code change — version-controlled, code-reviewed, type-checked.

**The practical limit is not architectural — it's operational.** You could define 500 task types, but each one needs:
- A well-written skill file (the AI's instruction manual)
- A trigger (how instances get created)
- Testing (does it produce good outcomes?)

The system can handle any number of types. The bottleneck is writing good skill files and validating they work.

**Future: user-defined task types.** The architecture supports a future where gym owners or our team can create custom task types through a UI — defining the goal, budget, cadence, and instructions without writing TypeScript. The `ad_hoc` type with gym-specific prompt overrides (§23.3) is the first step toward this.

---

## 37. Non-Binary Goal Evaluation

### 37.1 Why Goals Aren't Yes/No

The existing `CompletionEvaluation` (§16.3) has `goalAchieved: boolean`. That's too simple. Consider:

- A churn_risk member replies "I'll try to come in next week" — is the goal achieved? Sort of. 60% maybe.
- An onboarding member has checked in twice out of three target visits — is the goal achieved? 67% of the way there.
- A research task produced a report but the data was sparse — is the deliverable "done"? Technically yes, but low quality.

### 37.2 The Goal Progress Model

Replace the binary `goalAchieved` with a progress model:

```typescript
interface GoalProgress {
  // How far along are we? (0-100)
  progressPct: number

  // What outcome best describes where we are RIGHT NOW?
  currentOutcome: string              // code from goal.outcomes[]

  // How confident is the evaluator in this assessment?
  confidence: number                  // 0-100

  // Evidence
  evidenceType: 'concrete_signal' | 'verbal_commitment' | 'inferred' | 'partial_signal' | 'none'
  evidence: string

  // What's the recommended next action?
  recommendedAction: 'complete' | 'wait_and_verify' | 'continue' | 'escalate' | 'close_as_neutral'

  // For progressive goals (like onboarding): milestones hit
  milestones?: {
    name: string                      // 'first_checkin', 'second_checkin', 'third_checkin'
    hit: boolean
    hitAt?: string
  }[]

  // Outstanding risks
  risks: string[]
}
```

### 37.3 How the Pipeline Uses GoalProgress

```typescript
function evaluateGoalProgress(progress: GoalProgress, task: AgentTask, typeDef: TaskTypeDef): TaskAction {
  const outcome = typeDef.goal.outcomes.find(o => o.code === progress.currentOutcome)

  // Concrete signal + high confidence = complete
  if (progress.evidenceType === 'concrete_signal' && progress.confidence >= 80) {
    return { action: 'complete', outcome: progress.currentOutcome }
  }

  // Progressive goal with 100% progress = complete
  if (progress.progressPct >= 100 && progress.confidence >= 70) {
    return { action: 'complete', outcome: progress.currentOutcome }
  }

  // Verbal commitment + medium confidence = provisional complete (will be verified)
  if (progress.evidenceType === 'verbal_commitment' && progress.confidence >= 60) {
    return { action: 'complete', outcome: 'verbal_commitment', provisional: true }
  }

  // Good progress but not done = continue
  if (progress.progressPct > 0 && progress.progressPct < 100) {
    return { action: 'continue' }
  }

  // Low confidence on anything = escalate or wait
  if (progress.confidence < 50) {
    const budgetLow = task.budget_messages_used >= task.budget_messages_max - 1
    return budgetLow ? { action: 'escalate' } : { action: 'wait_and_verify' }
  }

  // Negative outcome detected
  if (outcome?.type === 'negative') {
    return { action: 'close_as_neutral', outcome: progress.currentOutcome }
  }

  return { action: 'continue' }
}
```

### 37.4 Progressive Goals (Milestones)

Some goals have measurable milestones:

```typescript
// Onboarding goal: 3 checkins in 30 days
signals: [
  { type: 'checkin', weight: 33, completesGoal: false, verificationWindow: 30 },
  { type: 'checkin_count_3', weight: 100, completesGoal: true, verificationWindow: 30 },
]
```

Each checkin is worth 33% progress. The AI sees:
```
GOAL PROGRESS: 67% (2 of 3 target checkins)
Milestones: ✓ first_checkin (day 3) | ✓ second_checkin (day 8) | ○ third_checkin (pending)
```

This lets the AI adapt its messaging: "Great to see you came in twice already! One more visit and you'll really have a rhythm going."

### 37.5 Fuzzy Judgment Goals

For goals where completion is genuinely subjective:

```typescript
// Ad-hoc task: "check in with Sarah about her knee injury"
goal: {
  summary: 'Check in with Sarah about her knee and make sure she knows we care',
  completionType: 'judgment',
  judgmentCriteria: `
    This goal is achieved when:
    - Sarah has responded and the conversation feels complete (she doesn't seem to be waiting for more)
    - OR the owner marks it as done
    - OR Sarah indicated she doesn't need anything

    This goal is NOT achieved by:
    - Sending a message with no reply (that's just "attempted", not "achieved")
    - A one-word reply like "thanks" (polite but not engaged)

    If you're unsure whether the conversation has reached a natural end, lean toward
    'wait_and_verify' — give her a day to reply again before closing.
  `,
  outcomes: [
    { code: 'connected', label: 'Connected', type: 'positive', description: 'Had a meaningful exchange about her situation', attributeRevenue: false },
    { code: 'acknowledged', label: 'Acknowledged', type: 'neutral', description: 'She replied briefly but conversation didn\'t develop', attributeRevenue: false },
    { code: 'unresponsive', label: 'No Response', type: 'neutral', description: 'No reply after outreach', attributeRevenue: false },
  ],
}
```

The AI evaluates this with judgment, not signals. The `judgmentCriteria` is specific enough to guide the AI but loose enough to handle ambiguity. If the AI's confidence is below 60, it defaults to `wait_and_verify` or `escalate` rather than guessing.

### 37.6 Owner Override on Goals

The owner can always override the AI's goal evaluation:

- **"This should be marked as retained"** → Owner changes outcome to `retained`, overriding the AI's `verbal_commitment` assessment
- **"This isn't done yet"** → Owner reopens a prematurely-closed task (transition `completed → executing` via escalation path)
- **"I handled this offline"** → Owner marks `owner_handled` regardless of what the AI thinks

Owner overrides are logged in `task_feedback` (§27.4) so we can learn from disagreements. If owners consistently override a certain outcome for a task type, our judgment criteria need adjustment.

---

## 38. Implementation Roadmap

> This section is the single source of truth for building the agentic task system.
> If you're picking this up in a new session, start here. Read the full spec for
> context, but this tells you what to build, in what order, and how to verify each phase.

### Current State (what exists today)

**Working:**
- `agent_tasks` table + CRUD in `lib/db/tasks.ts` (createTask, getTask, updateTaskStatus, createInsightTask)
- `task_conversations` table for per-task conversation history
- `agent_commands` table + command bus in `lib/db/commands.ts`
- `outbound_messages` table for email/SMS tracking
- RetentionAgent (`lib/agents/RetentionAgent.ts`) — handles reply evaluation loop
- GMAgent (`lib/agents/GMAgent.ts`) — runs analysis, creates insights, handles PushPress events
- BaseAgent (`lib/agents/BaseAgent.ts`) — abstract base with dependency injection
- Dashboard page (`app/dashboard/page.tsx`) — queries `agent_tasks`, shows review queue
- PushPress webhook (`/api/webhooks/pushpress`) → GMAgent event handler
- Resend inbound webhook (`/api/webhooks/resend`) → reply handling
- Cron: run-analysis, process-commands, attribute-outcomes, tick-workflows, daily-digest
- Skill files in `lib/task-skills/` (all 9 written: _base, churn-risk, win-back, lead-followup, payment-recovery, onboarding, staff-call-member, monthly-churn-analysis, ad-hoc)

**Legacy (must retire):**
- `agent_actions` table — still read/written by:
  - `lib/reply-agent.ts` (lines 46-189) — the old reply handler
  - `app/api/conversations/all/route.ts` (line ~76-89) — enriches threads with action status
  - `app/api/webhooks/resend/route.ts` — calls `handleInboundReply()` which uses agent_actions
  - `lib/workflow-runner.ts` (line 51) — stores optional action_id
- `agent_conversations` table — legacy per-action conversation log (replaced by `task_conversations`)
- `lib/reply-agent.ts` — entire file is legacy, replaced by RetentionAgent

**Not yet built:**
- TaskTypeDef registry (`lib/task-types.ts`)
- Skill file loader + `buildSystemPrompt()` with 6-layer composition
- New state machine (pending_review → ready → executing → waiting → dormant → completed/escalated/cancelled)
- Cadence-aware follow-up system
- Subtask model with requirement levels (required/optional/best_effort)
- Goal evaluation (non-binary GoalProgress model)
- Member coordinator (cross-task, rate limiting)
- Opt-out / suppression system
- Gym profile + context layering
- Onboarding ramp (shadow → guided → limited → full)
- Dry run / plan mode
- Platform observability
- Timezone-aware send windows

---

### Phase 0: Retire Legacy Dual-Write

**Goal:** One task system. All reads and writes go through `agent_tasks`. Stop writing to `agent_actions`.

**Files to modify:**

1. **`lib/reply-agent.ts`** — DELETE this file entirely. Its job is now handled by `RetentionAgent.handleReply()`.

2. **`app/api/webhooks/resend/route.ts`** — Change the `email.received` handler to:
   - Look up the task by reply token in `agent_tasks` (not `agent_actions`)
   - Call `RetentionAgent.handleReply()` instead of `handleInboundReply()`
   - The reply token is in the `Reply-To` address: `reply+{taskId}@lunovoria.resend.app`

3. **`app/api/conversations/all/route.ts`** — Remove `agent_actions` enrichment (lines ~76-89). Query `agent_tasks` + `task_conversations` instead.

4. **`lib/workflow-runner.ts`** — Remove `action_id` reference (line 51). Use `task_id` instead if workflow tracing is needed.

5. **`app/api/webhooks/inbound-email/route.ts`** — If it has a Phase 2 dual-run RetentionAgent block, remove the legacy path. Keep only the `agent_tasks` path.

**Don't touch:** `agent_actions` table stays in the DB. We just stop reading/writing it.

**Verify:** `npm run build` passes. Grep the codebase for `agent_actions` — should only appear in comments, migration files, and the schema definition. Zero runtime references.

---

### Phase 1: Task Type Registry + Skill File Loading

**Goal:** The `TaskTypeDef` contract is real code. Skill files load and compose into system prompts.

**New files to create:**

1. **`lib/task-types.ts`** — The task type registry. Contains:
   - `TaskTypeDef` interface (from §5)
   - `GoalDef`, `GoalSignal`, `GoalOutcome` interfaces (from §5.2)
   - `FollowUpCadence` interface + `CADENCES` presets (from §5.1)
   - `SubtaskRequirement` type (from §14.6)
   - `SAFETY_LIMITS` constant (from §7)
   - `TASK_TYPES` registry with all 8 task types fully defined
   - `getTaskType(type: string): TaskTypeDef` — returns type or falls back to `ad_hoc`

2. **`lib/task-skills/loader.ts`** — Skill file loader. Contains:
   - `loadSkillFile(path: string): string | null` — cached file reader
   - `getBaseSkill(): string` — loads `_base.md`
   - `buildSystemPrompt(gym, typeDef, task): string` — 6-layer prompt composition:
     - Layer 1: Base skill
     - Layer 2: Task type skill file
     - Layer 3: Gym context
     - Layer 4: Gym-specific overrides
     - Layer 5: Goal evaluation criteria
     - Layer 6: Cross-task context

3. **`lib/gym-profile.ts`** — Gym context builder. Contains:
   - `GymProfile` interface (from §23)
   - `buildGymContextPrompt(gym): string` — turns gym profile into prompt text
   - `getGymPromptOverride(accountId, agent, taskType): string | null`

**Files to modify:**

4. **`lib/agents/RetentionAgent.ts`** — Update `evaluateTask()` to use `buildSystemPrompt()` instead of its hardcoded system prompt. The agent's behavior is now driven by the skill file for the task's type.

5. **`lib/agents/GMAgent.ts`** — When creating insight tasks via `createInsightTask()`, set the `task_type` field to match `TASK_TYPES` keys (e.g., `'churn_risk'`, `'win_back'`, `'payment_recovery'`).

**Verify:** `npm run test` passes. Write a test in `lib/__tests__/task-types.test.ts` that:
- Loads every task type and verifies the contract is complete
- Loads every skill file and verifies it exists
- Builds a system prompt for each type and checks all 6 layers are present

---

### Phase 2: New State Machine + Execution Pipeline

**Goal:** Tasks flow through the full state machine with cadence-aware follow-ups.

**Database migration (Supabase SQL):**

```sql
-- New columns on agent_tasks
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS budget_messages_max INT DEFAULT 3;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS budget_messages_used INT DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS budget_days_max INT DEFAULT 14;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS budget_turns_max INT DEFAULT 6;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS budget_turns_used INT DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS followup_touch_index INT DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS dormant_at TIMESTAMPTZ;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS dormant_check_at TIMESTAMPTZ;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS dormant_expires_at TIMESTAMPTZ;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES agent_tasks(id);
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS requirement TEXT DEFAULT 'required';
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS goal_progress JSONB;

-- Update status CHECK constraint to include new states
ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_status_check
  CHECK (status IN ('pending_review', 'ready', 'executing', 'waiting', 'dormant', 'completed', 'escalated', 'cancelled',
                    'open', 'awaiting_reply', 'in_progress', 'resolved'));
-- Keep old statuses in CHECK for backward compat during migration

-- Status mapping for existing rows
UPDATE agent_tasks SET status = 'pending_review' WHERE status = 'open' AND requires_approval = true;
UPDATE agent_tasks SET status = 'ready' WHERE status = 'open' AND requires_approval = false;
UPDATE agent_tasks SET status = 'waiting' WHERE status = 'awaiting_reply';
UPDATE agent_tasks SET status = 'executing' WHERE status = 'in_progress';
UPDATE agent_tasks SET status = 'completed' WHERE status = 'resolved';
```

**New files:**

1. **`lib/task-executor.ts`** — The new execution pipeline. Replaces `process-commands` cron for task work. Contains:
   - `tickTasks(accountId?: string)` — main loop:
     - Query `ready` tasks → execute first touch
     - Query `waiting` tasks where `next_action_at` is past → execute follow-up (cadence-aware)
     - Query `dormant` tasks where `dormant_check_at` is past → check for outcome signals
     - Respects `SAFETY_LIMITS.cron.maxTasksExecutedPerRun`
   - `executeTask(task, typeDef)` — single task execution:
     - Build system prompt via `buildSystemPrompt()`
     - Call Claude for message draft
     - Send via Resend
     - Update budget counters
     - Set `next_action_at` based on cadence interval
   - `evaluateReply(task, reply, typeDef)` — reply evaluation:
     - Build prompt with conversation history + skill file
     - Call Claude for structured evaluation
     - Return GoalProgress (§37)
   - `checkBudget(task, typeDef)` — enforce limits:
     - Messages used vs max
     - Days elapsed vs max
     - Turns used vs max
     - On exhaustion: check cadence `onExhaustion` → cancel, escalate, or dormant

2. **`lib/task-state.ts`** — State machine enforcement. Contains:
   - `VALID_TRANSITIONS` map (from §3)
   - `transitionTask(task, newStatus, reason)` — validates transition, bumps version (optimistic lock), logs reason
   - `deriveParentStatus(subtasks)` — parent state from children (from §14.4, requirement-aware)

**Files to modify:**

3. **`app/api/cron/process-commands/route.ts`** — Keep for command bus processing. Add a call to `tickTasks()` or create a new cron route `/api/cron/tick-tasks`.

4. **`lib/db/tasks.ts`** — Add:
   - `getReadyTasks(accountId)` — tasks in `ready` state
   - `getWaitingTasksDue(accountId)` — tasks in `waiting` where `next_action_at <= now`
   - `getDormantTasksDue(accountId)` — tasks in `dormant` where `dormant_check_at <= now`
   - `incrementBudgetUsed(taskId, field)` — atomic increment of budget counters
   - `transitionWithVersion(taskId, newStatus, expectedVersion)` — optimistic locking update

5. **`app/api/webhooks/resend/route.ts`** — On member reply:
   - Load the task
   - Call `evaluateReply()` from task-executor
   - If reply comes to a `dormant` task → wake it up (dormant → executing)

**Verify:** Write tests in `lib/__tests__/task-executor.test.ts`:
- Task moves through full lifecycle: ready → executing → waiting → executing (follow-up) → completed
- Budget exhaustion triggers correct `onExhaustion` behavior
- Dormant tasks wake up on member reply
- Optimistic lock rejects stale updates
- Follow-up uses correct cadence interval and tone

---

### Phase 3: Attribution + Scorecard API

**Goal:** The system can say "we retained Alex, worth $175/month" and the dashboard can show it.

**Files to modify:**

1. **`app/api/cron/attribute-outcomes/route.ts`** — Rewrite to:
   - Query `agent_tasks` where `status IN ('completed', 'waiting', 'dormant')` and `outcome IS NULL`
   - For each: check outcome signals from `GoalDef.signals` (e.g., checkin via PushPress API)
   - If signal found: set `outcome`, `attributed_value`, `goal_progress`
   - Use `gym.avg_membership_price` (add column to `gyms` table, default 150)
   - If attribution window expired: set outcome based on task state

2. **`lib/db/kpi.ts`** — Add `getMonthlyRetentionROI(accountId, month?)`:
   - Tasks created, messages sent, members retained, revenue retained
   - Query `agent_tasks` filtered by account_id and created_at within month

3. **`app/api/retention/scorecard/route.ts`** — GET endpoint returning `getMonthlyRetentionROI()`.

4. **`lib/roi.ts`** — Accept `membershipValue` param instead of hardcoded `$130`.

**Database:**
```sql
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS avg_membership_price NUMERIC DEFAULT 150;
```

**Verify:** Trigger analysis → approve a message → simulate a checkin → run attribution cron → call `/api/retention/scorecard` → verify numbers are real.

---

### Phase 4: Dashboard UI

**Goal:** Owner opens dashboard → knows what's happening in 3 seconds.

**New components:**

1. **`components/RetentionScorecard.tsx`** — 4 hero numbers at top:
   - Members retained this month
   - Revenue saved
   - Conversations active
   - Needs attention count
   - Design per BRAND.md: no border-radius, `#0063FF` accent

2. **`components/ActivityFeed.tsx`** — Timeline of recent task events:
   - "Reached out to Alex M." / "Alex replied" / "Alex checked in"
   - Pull from `task_conversations` joined with `agent_tasks`
   - Outcome badges: retained (green), churned (red), in progress (blue)

3. **`app/api/retention/activity/route.ts`** — Feed data endpoint.

**Files to modify:**

4. **`app/dashboard/page.tsx`** — Restructure:
   - Top: Scorecard
   - Left/main: Review queue (existing `ReviewQueue` component) + escalations
   - Right: Activity feed (desktop) or below (mobile)
   - Keep GM Chat in the right panel via `AgentPageLayout`

5. **`components/ReviewQueue.tsx`** — Already built. Minor updates:
   - Show task type badge (churn_risk, win_back, etc.)
   - Show which touch number this is ("Touch 2 of 3")

**Verify:** Open `localhost:3000/dashboard` → scorecard shows real data → approve a message → feed updates.

---

### Phase 5: Autopilot + Safety

**Goal:** Owner flips a switch, agent runs autonomously with safety rails.

**Database:**
```sql
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN DEFAULT false;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS autopilot_phase TEXT DEFAULT 'shadow';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS autopilot_enabled_at TIMESTAMPTZ;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS send_window_start INT DEFAULT 8;
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS send_window_end INT DEFAULT 20;
```

**Files to modify:**

1. **`lib/task-executor.ts`** — Before sending any message:
   - Check `gym.autopilot_enabled` and `gym.autopilot_phase`
   - Shadow mode: log "would have sent" but don't actually send
   - Check send window (timezone-aware): skip if outside hours, set `next_action_at` to next window open
   - Check daily send limit: `SAFETY_LIMITS.gym.maxSendsPerDay`
   - Check member weekly limit: `SAFETY_LIMITS.member.maxMessagesPerWeek`

2. **`lib/db/tasks.ts`** — In `createInsightTask()`:
   - When `gym.autopilot_enabled` and confidence >= `typeDef.autoThreshold`: set `requires_approval = false`
   - Always require approval for escalations regardless of autopilot

3. **`app/api/settings/autopilot/route.ts`** — POST toggle:
   - Enable → set `autopilot_phase = 'shadow'`, `autopilot_enabled_at = now()`
   - After 7 days → auto-promote to `'guided'` (cron checks this)

4. **Settings UI** — Add autopilot toggle with clear explanation of shadow mode.

**Verify:** Enable autopilot → trigger analysis → verify task auto-approves (non-escalation) → verify shadow mode logs but doesn't send → verify daily limit blocks 16th message.

---

### Phase 6: Member Coordination + Suppression

**Goal:** No member gets spammed. Opt-out works instantly.

**Database:**
```sql
CREATE TABLE IF NOT EXISTS member_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  member_email TEXT NOT NULL,
  suppression_type TEXT NOT NULL, -- 'all', 'agent_type:retention', 'task_type:churn_risk'
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- null = permanent
  UNIQUE(account_id, member_email, suppression_type)
);
```

**New files:**

1. **`lib/member-coordinator.ts`** — Contains:
   - `canMessageMember(accountId, email)` — checks suppression table + weekly message count
   - `checkSuppression(accountId, email)` — returns suppression record if active
   - `addSuppression(accountId, email, type, reason)` — inserts suppression
   - `detectOptOut(replyText)` — keyword + AI detection for opt-out intent

**Files to modify:**

2. **`lib/task-executor.ts`** — Before any outbound message:
   - Call `canMessageMember()` — if suppressed, skip silently
   - After receiving a reply: call `detectOptOut()` — if detected, suppress and close all active tasks for that member

**Verify:** Send opt-out reply → verify all tasks for that member close → verify new tasks for that member are blocked.

---

### Implementation Order

```
Phase 0 (retire legacy)     ← prerequisite for everything
    ↓
Phase 1 (type registry)     ← the new engine core
    ↓
Phase 2 (state machine)     ← the execution pipeline
    ↓
Phase 3 (attribution)       ← proves value
    ↓
Phase 4 (dashboard UI)      ← owner sees value
    ↓
Phase 5 (autopilot)         ← owner trusts system enough to let go
    ↓
Phase 6 (coordination)      ← safety at scale
```

Each phase is independently deployable. Don't skip Phase 0 — everything else depends on a single task system.

### What "Done" Looks Like

The system is done when a gym owner can:
1. Connect their PushPress account
2. See at-risk members surface automatically
3. Approve or let autopilot handle outreach
4. Watch conversations happen
5. See "5 members retained, $750 saved this month" on their dashboard
6. Trust that the system won't embarrass them

That's it. Everything in the 5,000-line spec serves those 6 outcomes.
