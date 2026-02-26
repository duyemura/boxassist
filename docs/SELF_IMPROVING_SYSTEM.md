# Self-Improving System

_How agents get smarter with every interaction — and why this is the core mechanism, not a feature bolted on later._

---

## The Architectural Problem This Solves

GymAgents was built with hardcoded gym assumptions baked into the code:

- `if (daysSinceCheckin > 14) riskLevel = 'high'` — a threshold we invented
- `task_type: 'churn_risk' | 'win_back' | 'payment_failed'` — categories we pre-defined
- `PPCustomer`, `PPCheckin`, `PPEnrollment` — rigid types tied to one platform
- `_handleStatusChanged()` reacting to specific event names we anticipated

This works today. It breaks when the gym is a yoga studio on Mindbody. It breaks when "churn" looks different at a BJJ school with belt promotions. It breaks when a new event type matters and we haven't written the handler yet.

The right split is:

```
Hardcoded:   infrastructure, safety rails, attribution, connectors
AI-driven:   pattern detection, risk assessment, message crafting,
             categorization, follow-up timing, escalation judgment
Context:     memories, skill files, connector schemas — what the AI knows
```

The self-improving system is how we move knowledge from the first column to the third. Every hardcoded assumption is a candidate for replacement by something learned from evidence. The goal is a system where the AI figures out what "at risk" means for *this* business, *these* members, *this* context — not a system that enforces our assumptions about gyms.

---

## The Core Insight: We Have Ground Truth

Most AI systems improve by asking "was that good?" We can ask: **did it work?**

Because we close the attribution loop — tracking whether a member came back, whether revenue was retained, whether a cancelled member reactivated — every completed interaction is a labeled example with a verifiable outcome. This changes the learning signal from preference inference to outcome measurement.

At 100 businesses × 30 tasks/week = 3,000 labeled outcome signals per week. That compounds into a durable advantage: the system's understanding of what works isn't based on our assumptions but on evidence from real interactions.

---

## The Three Learning Loops

### Loop 1 — Business Context (What do we know about this business?)

Every business has a personality the generic prompts don't capture: how the owner communicates, when their clients are reachable, what language resonates with their audience, what triggers the owner to escalate vs. trust the agent. Today we start from scratch every time.

This loop captures what we've learned and makes it available to every future interaction. Critically, this is **not a set of gym-specific facts** — it's a general context layer that works for any business type:

- A gym: _"Owner prefers direct language, no emojis, messages sent after 6pm"_
- A yoga studio: _"Members respond better to 'come back when you're ready' than urgency framing"_
- A BJJ school (future): _"Belt promotions are milestone moments — reference rank in outreach"_
- A Pilates studio (future): _"Most clients are regulars who pre-book — absence from booking queue is the signal, not check-in absence"_

The AI determines what's worth remembering and how to express it. The system stores and retrieves it. The format is freeform text, not typed fields.

### Loop 2 — Pattern Effectiveness (What actually produces outcomes?)

Because we measure outcomes, we can correlate message patterns with results without manually defining what "good" looks like. The AI finds the patterns; the evidence validates them.

Today we have:
```typescript
// Hardcoded
if (daysSinceCheckin >= 14) score += 0.45
if (daysSinceCheckin >= 7)  score += 0.25
```

With Loop 2, the system observes: at *this* business, members who miss 2 consecutive Mondays — regardless of total days absent — churn at 3x the rate. That's a pattern the current code can't capture because we hardcoded a days-based threshold instead of asking the AI to reason about patterns.

This loop doesn't replace the scoring formula — it surfaces evidence that the scoring formula is wrong for this context, and generates a suggestion to correct it.

### Loop 3 — Model Calibration (How accurate are our assessments?)

The current risk model was calibrated against industry research. It may be miscalibrated for any given business. Loop 3 closes this: when we flag 10 "high risk" members and 9 of them respond positively to outreach (i.e., they weren't really at risk), we learn the threshold is too aggressive for this gym. When 4 of 10 "medium risk" members churn without a task being created, we learn the threshold is too conservative.

This is the mechanism by which the system's judgment — currently our judgment, embedded in code — gets replaced by judgment calibrated to actual evidence at this business.

---

## How This Connects to the Hardcoding Problem

The self-improving system is not a feature on top of the existing architecture. It's the mechanism by which the current hardcoded architecture evolves toward the right one.

Each learning loop targets a specific category of hardcoded assumption:

| Hardcoded today | What replaces it | Loop |
|---|---|---|
| `if (daysSinceCheckin > 14) = high risk` | AI reasons about what's abnormal for this business/member | Loop 3 (calibration) |
| `task_type: 'churn_risk' \| 'win_back' \| ...` | AI describes the situation in natural language; type becomes a hint, not a driver | Loop 2 (pattern) |
| `PPCustomer`, `PPCheckin` rigid types | Abstract entity model + connector schemas the AI interprets in context | Loop 1 (context) |
| `_handleStatusChanged()` specific handler | AI evaluates "something happened — does it matter, and how?" | Loop 2 (pattern) |
| Skill files with gym-specific framing | Skill files as general capability descriptions + business context layered on top | Loop 1 (context) |

The transition doesn't happen all at once. It happens task by task, business by business, as the learning loops accumulate evidence and replace our assumptions with theirs.

---

## Architecture

### What Stays Rigid (Infrastructure Layer)

These do not change:

- **Security** — `account_id` scoping, auth, encryption, RLS policies
- **Reliability** — command bus, retry logic, idempotency, audit logging
- **Safety rails** — daily send limits, escalation triggers, opt-out enforcement, shadow mode
- **Attribution** — "did they come back?" needs a concrete definition to measure ROI; this can't be vague
- **Connectors** — the plumbing that gets data from PushPress (or Mindbody, etc.) into the system

### What Becomes AI-Driven (Reasoning Layer)

These should not be hardcoded:

- **Pattern detection** — what constitutes "at risk" for this business
- **Categorization** — what kind of situation is this, what kind of response does it need
- **Timing judgment** — when is the right moment to act
- **Message crafting** — what to say and how to say it for this audience
- **Escalation judgment** — what needs human attention vs. what the agent can handle
- **Outcome interpretation** — what does "success" look like in this context

### What Lives in Context (Knowledge Layer)

This is where learning accumulates:

- **Business memories** — freeform, AI-authored, owner-approved facts about this business
- **Skill files** — natural language capability descriptions (already building this)
- **Connector schemas** — what data is available from this connector and what it means
- **Cross-business patterns** — anonymized, general learnings from aggregate outcomes

### Data Model

Designed to be domain-agnostic. No gym-specific fields.

```sql
-- Unified memory store — account context, member facts, cross-business patterns
-- scope determines what this memory is about and who can read it
CREATE TABLE memories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- scope: what this memory is about
  scope             text NOT NULL,  -- 'account' | 'member' | 'business_type' | 'system'

  -- exactly one scoping field is set, depending on scope:
  account_id        uuid REFERENCES accounts(id) ON DELETE CASCADE,
  member_id         text,           -- set for scope='member'; null otherwise
  business_type_tag text,           -- set for scope='business_type'; freeform, not a FK

  content           text NOT NULL,         -- freeform: the AI writes this, the AI reads this
  category_hint     text,                  -- soft label: 'preference' | 'context' | 'pattern'
                                           -- 'business_profile' for the bootstrapped type context
                                           -- AI-generated, not enforced — informational only
  confidence        decimal DEFAULT 0.7,
  source            text,                  -- 'agent' | 'owner_edit' | 'gm_chat' | 'evaluator'
  source_task_ids   uuid[],
  privacy_tier      text DEFAULT 'account_private',
  created_at        timestamptz DEFAULT now(),
  last_confirmed_at timestamptz DEFAULT now(),
  expires_at        timestamptz
);

-- Indexes
CREATE INDEX idx_memories_account_scope  ON memories(account_id, scope) WHERE account_id IS NOT NULL;
CREATE INDEX idx_memories_member         ON memories(account_id, member_id) WHERE member_id IS NOT NULL;
CREATE INDEX idx_memories_business_type  ON memories(business_type_tag) WHERE business_type_tag IS NOT NULL;
CREATE INDEX idx_memories_system         ON memories(scope) WHERE scope = 'system';

-- Loading patterns by context:
--   Analysis run:      scope IN ('account', 'system') WHERE account_id = $accountId
--   Task execution:    scope IN ('account', 'member', 'system') WHERE account_id = $accountId
--                      AND (member_id IS NULL OR member_id = $memberId)
--   Cross-business:    scope = 'business_type' WHERE business_type_tag = $tag
--
-- Business profile bootstrap (written by GM Agent on first run):
--   scope='account', category_hint='business_profile', source='agent'
--   content: "This is [Name]. Based on their data, this is a CrossFit box..."

-- Pending suggestions from evaluator analysis
-- suggestion_type aligns to output types: memory, skill, rubric, prompt, calibration
CREATE TABLE improvement_suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid REFERENCES accounts(id),  -- null = cross-business suggestion
  suggestion_type   text NOT NULL,       -- 'memory' | 'skill' | 'rubric' | 'prompt' | 'calibration'
  title             text NOT NULL,
  description       text NOT NULL,       -- written by AI for the owner to read and evaluate
  proposed_change   jsonb NOT NULL,      -- structured enough to apply; flexible enough to be general
                                         -- memory: { content, category_hint, confidence }
                                         -- skill: { applies_when, domain, guidance, sources }
                                         -- rubric: { criteria[], applies_to_task_types[] }
                                         -- prompt: { instruction, applies_to_skills[] }
                                         -- calibration: { current_behavior, suggested_behavior, evidence_summary }
  evidence          jsonb NOT NULL,      -- { task_ids, outcome_stats, reasoning, sample_count }
                                         -- NEVER includes message text or PII for cross-business suggestions
  confidence_score  decimal NOT NULL,    -- 0.0–1.0
  evidence_strength text NOT NULL,       -- 'strong' | 'moderate' | 'weak'
  status            text DEFAULT 'pending',  -- 'pending' | 'accepted' | 'dismissed' | 'auto_applied'
  privacy_tier      text NOT NULL,       -- 'account_private' | 'business_type_shared' | 'system_wide'
  business_type_tag text,                -- freeform tag for routing cross-business suggestions
                                         -- e.g. 'crossfit_gym', 'yoga_studio' — not a FK
  source            text NOT NULL,       -- 'post_task_eval' | 'weekly_batch' | 'cross_business' | 'edit_analysis'
  related_task_ids  uuid[],
  auto_apply_eligible boolean DEFAULT false,  -- true if meets trust gradient criteria
  created_at        timestamptz DEFAULT now(),
  reviewed_at       timestamptz,
  applied_at        timestamptz
);

-- Raw signal: message style + verifiable outcome pair
-- No business-specific fields — works for any business/member/interaction type
-- This is the source table for all learning. Cross-business analysis reads ONLY from here.
CREATE TABLE interaction_outcomes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  task_id           uuid NOT NULL REFERENCES agent_tasks(id),
  business_type_tag text,                -- freeform, from account's business profile at time of interaction
  interaction_type  text NOT NULL,         -- AI-generated description, not hardcoded type
  context_summary   text,                  -- AI-authored summary (account-private, never crosses tenants)
  message_sent      text,                  -- what was sent (account-private, never crosses tenants)
  outcome           text,                  -- 'engaged' | 'recovered' | 'churned' | 'unresponsive'
  days_to_outcome   integer,
  attributed_value  decimal,
  touch_number      integer,               -- which touch in the sequence (1, 2, 3)
  message_length    integer,               -- char count — safe for cross-tenant analysis
  sent_at_hour      integer,               -- 0-23, local time — safe for cross-tenant analysis
  owner_edited      boolean DEFAULT false,
  edit_summary      text                   -- AI-authored (account-private, never crosses tenants)
);

-- Accepted rubrics — evaluation criteria used by the evaluator
CREATE TABLE evaluation_rubrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid REFERENCES accounts(id),  -- null = system-wide rubric
  business_type_tag text,                           -- null = account-specific
  name              text NOT NULL,
  criteria          jsonb NOT NULL,         -- [{ name, description, weight }]
  applies_to        text[],                 -- task types or skill names this rubric applies to
                                            -- empty = general rubric (applies to all)
  source_suggestion_id uuid REFERENCES improvement_suggestions(id),
  active            boolean DEFAULT true,
  created_at        timestamptz DEFAULT now()
);
```

### Cross-Tenant Privacy Boundary

Not all knowledge is equal. Some is deeply private (owner's personal details, member facts). Some is structurally useful across similar businesses. The system must enforce a hard boundary between these tiers.

| Tier | Crosses tenants? | What belongs here | Examples |
|---|---|---|---|
| **Account-private** | Never — hard rule | Owner preferences, member-specific facts, message content, edit diffs, personal information | "Dan has a daughter", "Sarah was injured in December", "Owner signs off as Coach Mike", all `member_id`-scoped memories |
| **Business-type-shared** | Yes, within same `business_type_tag` | Cross-business patterns tagged with a `business_type_tag` (e.g. `'crossfit_gym'`). Routed to accounts whose bootstrapped business profile matches the tag. Requires 3+ contributing accounts. | "CrossFit members who miss 2 WODs churn at 3x rate", "Touch 2 with a specific class name gets 2.3x replies for gyms" |
| **System-wide** | Yes, all accounts | Universal patterns about communication and timing, validated by 5+ accounts across 2+ business types | "Evening sends get 61% same-day response vs 12% morning", "Messages under 3 sentences get 40% more replies" |

**Enforcement rules:**

1. Memories with `source: 'owner'` or `source: 'owner_edit'` → **always account-private**
2. Memories with any `member_id` set → **always account-private**
3. Memories with `category_hint: 'preference'` → **always account-private**
4. Only `interaction_outcomes` rows feed cross-tenant analysis — never raw message text, never member names/emails
5. Cross-business patterns require `evidence_strength: 'strong'` (3+ contributing accounts) before surfacing
6. System-wide patterns require 5+ accounts across 2+ `business_type` branches
7. Cross-business patterns tagged with a `business_type_tag` only surface to accounts whose AI-inferred business profile matches that tag. Matching is done at query time — no FK constraint, no rigid hierarchy.

**What gets anonymized for cross-tenant analysis:**

```
INCLUDED:  interaction_type, outcome, days_to_outcome, touch_number,
           message_length, time_of_day_sent, owner_edited (boolean),
           business_type_tag, attributed_value (rounded to nearest $50)

EXCLUDED:  message_sent, edit_summary, member name/email, account name,
           any content from memories (all scopes), any context_summary text
```

### Improvement Output Types

After every evaluation (post-task, weekly batch, or cross-business), the evaluator produces **suggestions** — not changes. Every suggestion needs owner review before it takes effect (unless the owner has opted into auto-apply for that type).

Five distinct output types, each with different effects when accepted:

#### Memory

A fact about this business the agent should remember for future interactions.

- **Effect when saved:** Creates a row in `memories` (scope='account') → injected into all future agent prompts for this account
- **Examples:** "Send messages after 6pm — morning sends go unopened at this gym", "Owner prefers casual tone, first names only"
- **Always account-private.** Memories never cross tenants.
- **Owner action:** Dismiss / Save

#### Skill

A new capability or knowledge reference the agent should have when handling a specific type of situation.

- **Effect when built:** Creates a new skill file (stored in DB, `skills` table) with `applies_when` header, domain guidance, and source references
- **Examples:** "Zion & Southern Utah Backcountry Logistics" (from Hyperagent), or for us: "Post-Injury Return Protocol — how to handle members coming back from injury", "Seasonal Churn Prevention — pre-emptive outreach before historically high-churn months"
- **Can be account-specific or system-wide.** Account-specific skills are loaded only for that account. System-wide skills (generated from cross-business patterns) are available to all accounts of the relevant business type.
- **Owner action:** Dismiss / Quick (auto-generate) / Build (interactive refinement)

#### Rubric

Evaluation criteria for judging agent output quality on a specific type of task.

- **Effect when accepted:** Added to the evaluator's prompt for similar future tasks → the evaluator scores future messages against these criteria
- **General rubrics** come from `_base.md` (no surveillance language, message length, ends with question, etc.) — these are always active
- **Task-specific rubrics** are auto-generated from outcomes: "For win-back messages at this gym, the agent should: acknowledge the cancellation without guilt, reference their tenure, mention a specific class they attended"
- **Examples:** "Multi-artifact creation with heavy web research requires explicit source verification" (from Hyperagent), or for us: "At-risk outreach should never mention the member's absence directly in Touch 1"
- **Can be account-specific or shared.** Account-specific rubrics capture this owner's quality bar. Shared rubrics capture general best practices validated across accounts.
- **Owner action:** Dismiss / Accept

#### Prompt

An instruction that modifies how the agent approaches a type of task. More specific than a skill (which is a whole playbook), a prompt is a targeted instruction.

- **Effect when applied:** Appended to the relevant skill file's context for this account (stored as a per-account skill override in `skills` table)
- **Examples:** "When planning trips for shoulder seasons, proactively verify seasonal road closures" (from Hyperagent), or for us: "Reference the member's last class type by name in the opening line of churn-risk outreach", "For win-back messages, always mention the gym's Saturday community class"
- **Always account-specific.** Prompts are the mechanism for per-account skill customization.
- **Owner action:** Dismiss / Apply

#### Calibration

A signal that the system's risk assessment may be miscalibrated for this business.

- **Effect when confirmed:** Adjusts the system's understanding of what "at risk" means for this business. In practice, this creates a memory like "Members at this gym routinely take 2-week breaks — don't flag as at-risk until 21+ days"
- **Examples:** "Attendance threshold may be too aggressive — 3 members flagged as high risk this week were fine"
- **Always account-specific.** Each business has its own normal.
- **Owner action:** Dismiss / Confirm / Remind me later (monitor for more data)

### Trust Gradient for Auto-Apply

Owners shouldn't have to review every suggestion forever. As trust builds, the system earns the right to auto-apply low-risk improvements.

| Level | When available | What auto-applies | What still needs review |
|---|---|---|---|
| **Review all** (default) | Always | Nothing | Everything |
| **Auto-save memories** | After 30 days, opt-in | Memories with `evidence_strength: 'strong'` and `confidence_score >= 0.8` | Skills, rubrics, prompts, calibrations |
| **Auto-apply proven** | Pro tier, after 60 days, opt-in | Memories + prompts that match patterns already accepted by 3+ similar businesses | New skills, rubrics, calibrations |

This mirrors the autopilot trust gradient (`draft_only → smart → full_auto`). The same owner who trusts autopilot to send messages will likely trust auto-apply for proven improvements. The same owner who reviews every message will want to review every suggestion.

**Weekly digest for auto-applied changes:** When auto-apply is active, the owner gets a weekly email: "Your agent learned 3 things this week" with a summary and one-click undo for each.

### The Evaluator

The evaluator is the engine that turns completed interactions into learning. It runs after every task closes, with no hardcoded understanding of what "a gym" is — it gets the data and reasons from it.

#### System Prompt (domain-agnostic)

```
You are an evaluator for an AI business agent system.
Your role is to analyze completed interactions and extract learnings that would
improve future performance.

You do NOT have domain-specific rules. You reason from the data:
  - What happened (the situation, the messages sent, the outcome)
  - What the business context suggests about this type of situation
  - Whether the outcome was better or worse than similar past interactions
  - What patterns, if any, this interaction is part of

You produce five types of improvements:

1. MEMORY — a fact about this business the agent should remember.
   Save when: owner edits reveal a preference, a pattern about this business emerges,
   or the interaction reveals context we didn't have.
   Example: "This business's clients respond better to evening messages"

2. SKILL — a new capability or knowledge area the agent needs.
   Save when: the agent encountered a situation no existing skill covers,
   or a specific domain area needs its own playbook.
   Example: "Post-injury return protocol — specialized handling for members returning from injury"

3. RUBRIC — evaluation criteria for judging agent quality on this type of task.
   Save when: outcomes reveal what makes a good vs bad message for this situation.
   Example: "Win-back messages should acknowledge the cancellation without guilt"

4. PROMPT — a targeted instruction that modifies how the agent approaches tasks.
   Save when: a specific technique correlates with better outcomes.
   Example: "Reference the client's last activity by name in the opening line"

5. CALIBRATION — a signal that risk assessment is miscalibrated for this business.
   Save when: flagged-as-at-risk people turn out fine, or unflagged people churn.
   Example: "Members here routinely take 2-week breaks — 14-day threshold is too aggressive"

Generate suggestions when:
  - A clear pattern is emerging (even if one data point — flag as 'weak')
  - The outcome was unexpectedly good or bad
  - The owner's edits reveal an implicit preference we didn't know about
  - The interaction reveals something about this business we should remember
  - The agent handled a situation no existing skill covers well

Do NOT generate suggestions for:
  - Expected outcomes with no new signal
  - Situations where one data point is ambiguous
  - Anything involving safety, compliance, or infrastructure

Return a JSON array. Each suggestion must include:
  - suggestion_type: 'memory' | 'skill' | 'rubric' | 'prompt' | 'calibration'
  - title (short, specific, owner-readable)
  - description (what you learned and why it matters)
  - proposed_change (structured — see schema per type)
  - confidence_score (0.0–1.0)
  - evidence_strength ('strong' | 'moderate' | 'weak')
  - reasoning (internal — your chain of thought)
```

The evaluator doesn't know it's evaluating a gym interaction. It knows a business agent completed a task with a particular outcome. This is intentional — it means the same evaluator works for a yoga studio, a BJJ school, a Pilates studio without modification.

#### Trigger: Post-Task

Runs immediately when a task closes. Receives the full interaction record. Generates 0–3 suggestions. Runs async — never blocks the task pipeline.

#### Trigger: Weekly Batch

Runs for each connected business, analyzing the past 7 days as a group. Looks for aggregate patterns not visible in individual interactions: approval/dismiss rates, timing clusters, outcome distributions by interaction type, segments where the agent is systematically over- or under-performing.

#### Trigger: Cross-Business Monthly

Runs across all connected businesses. Anonymized — no PII, only structural patterns and outcome statistics. Surfaces general learnings that apply to specific business types. Requires 3+ contributing businesses before any pattern is surfaced.

### Dynamic Context Injection

When the agent drafts a message or runs an analysis, it assembles the full context for this business:

```typescript
async function buildAgentContext(accountId: string, situation: string): Promise<string> {
  // 1. Relevant skill files (capability descriptions)
  const skills = await loadRelevantSkills(situation)

  // 2. Active business memories (freeform, AI-authored)
  const memories = await getActiveMemories(accountId)
  // Injected as-is — the AI wrote them for the AI to read
  const memoryBlock = memories.map(m => m.content).join('\n')

  // 3. Connector context (what data is available and what it means for this business)
  const connectorContext = await getConnectorContext(accountId)

  // No hardcoded gym logic here — the AI reasons from skills + memories + data
  return assembleContext(skills, memoryBlock, connectorContext)
}
```

The agent gets smarter for each business over time without any code changes. Adding a memory for a yoga studio doesn't require a yoga-specific code path. The memory is freeform text the AI knows how to use.

### Owner Edit Signal

When an owner edits a draft before sending, we're throwing away one of the richest signals in the system. The diff between what the agent wrote and what was actually sent is direct evidence of the gap between the agent's understanding of this business and reality.

```typescript
// On manual approval with modified message
const editSummary = await claudeEvaluate(
  'You are analyzing an edit to an AI-generated message. Describe what changed and what preference or context this might reveal about the business or its owner. Be specific but concise.',
  `Original: ${originalDraft}\n\nSent: ${editedMessage}`
)

// Stored in interaction_outcomes.edit_summary
// Evaluator uses this as high-signal input when analyzing the task
```

Three edits with a consistent pattern → weak suggestion. Five → moderate. Eight → strong memory candidate.

### Owner Review UI

```
Improvements                          [All]  [Pending 5]  [Applied]  [Dismissed]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🧠 Memory                                           Strong (84%)
  Send messages after 6pm — morning sends go unopened
  ─────────────────────────────────────────────────────────
  In 7 of 9 interactions where the member responded same-day,
  the message was sent after 5:30pm. Morning sends have a 12%
  same-day response rate vs. 61% for evening sends at this gym.
                                              [Dismiss]  [✓ Save]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💬 Prompt Update                                    Moderate (67%)
  Mention the specific class when reaching out to at-risk members
  ─────────────────────────────────────────────────────────
  4 of 5 re-engagements this month came from messages that named
  a specific class. Generic messages: 1 of 7 re-engaged.
  Proposed addition to churn_risk skill: "Reference the member's
  last class type by name in the opening line."
                                              [Dismiss]  [✓ Apply]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 Calibration                                       Weak (41%)
  Attendance threshold may be too aggressive for this gym
  ─────────────────────────────────────────────────────────
  3 members flagged as "high risk" this week responded positively
  to outreach and had no stated intent to leave. This gym's members
  may have longer natural gaps than average. Only 1 data point —
  monitoring before escalating to a threshold change.
                                              [Dismiss]  [Remind me]
```

The UI is intentionally not gym-specific. An owner of any business type sees the same interface. The suggestions are written by the AI in language appropriate to their context.

---

## The Cross-Business Flywheel

```
Individual interaction outcomes (labeled, attributed)
             ↓
  Anonymized structural patterns
  (no PII — see Cross-Tenant Privacy Boundary above)
             ↓
  Cross-business pattern detection
  (requires 3+ businesses, monthly cadence)
             ↓
  Patterns tagged with a business_type_tag
  (e.g. 'crossfit_gym', 'fitness_business', null for system-wide)
             ↓
  Suggestions routed to accounts whose business profile matches the tag
  ("CrossFit gyms: October is highest churn month — pre-emptive outreach in September")
             ↓
  Owner accepts → improves context for that business type
             ↓
  New businesses of that type start with better priors
             ↓
  More businesses → more signal → better patterns
```

### How Business Type Tags Work

Business type is not a rigid taxonomy. It's a **freeform tag** written by the AI when it bootstraps a new account's business profile.

When a new account connects:
1. The connector pulls basic account data (name, class types, member stats)
2. A bootstrap LLM call writes a `business_profile` memory: *"This is Iron & Grace Athletics. Based on their data, this is a CrossFit box. Members are athletes, classes are WODs..."*
3. The GM Agent tags this memory with an inferred `business_type_tag` (e.g. `'crossfit_gym'`)
4. This tag is also stored on `accounts.business_type_tag` for query purposes

When the cross-business evaluator finds a pattern:
1. **Tag attribution:** The evaluator decides which tag this pattern belongs to. "Evening sends get more replies" → `null` (system-wide). "Members who miss 2 consecutive sessions churn at 3x" → `'fitness_business'`. "Athletes who skip Open prep WODs churn" → `'crossfit_gym'`.
2. **Routing:** A `memories` row with `scope='business_type'` and `business_type_tag='crossfit_gym'` surfaces to accounts whose `business_type_tag` matches or is semantically close.
3. **New account priors:** On first run, the GM Agent reads system-scoped memories and business_type-scoped memories matching the account's inferred tag. A new CrossFit gym immediately benefits from all prior CrossFit patterns.
4. **Fluid types:** If an account is a CrossFit/yoga hybrid, the business profile memory says so. The agent reads it and reasons accordingly — no taxonomy change needed.

### The Compound Moat

After 6 months with 50 connected businesses:
- 90,000+ labeled interaction-outcome pairs
- Calibrated risk thresholds per business type — not our assumptions, evidence
- Proven message patterns by segment, timing, audience type
- A new business joining immediately benefits from all prior learning at their type level

No competitor can acquire this without also acquiring the customer relationships. The advantage compounds weekly. And because the architecture is abstract — not gym-specific — this flywheel works equally for the next vertical we enter.

Freeform `business_type_tag` values are what make this scale beyond "50 gyms all learning the same things." A CrossFit gym benefits from patterns tagged `'crossfit_gym'` AND `'fitness_business'` AND system-wide patterns. Each new account with a distinct tag creates a new surface for pattern accumulation — without any schema change.

---

## Implementation Roadmap

Phases are numbered SI-1 through SI-7 (Self-Improvement) to distinguish from the main product plan phases.

### SI-1 — Signal Collection (foundation)
_No visible changes to owners. Start building the data needed to learn._

- [ ] `interaction_outcomes` table + migration
- [ ] Populate on every task close: AI-authored context summary, touch number, message length, send hour
- [ ] Capture owner edit diffs on manual approval — run through Claude (Haiku) for `edit_summary`
- [ ] `memories` table + migration; `accounts.business_type_tag` column
- [ ] Log dismissals with optional owner annotation (currently we dismiss but don't record why)
- [ ] Ensure task outcomes are reliably attributed before learning from them

**Depends on:** Attribution cron (done). Autopilot approve API (done).
**Files:** `lib/migrations/0XX_self_improving_tables.sql`, `lib/db/interaction-outcomes.ts`, modify `app/api/autopilot/approve/route.ts`

### SI-2 — Business Memory (immediate owner value)
_Owners can teach the system about their business. No evaluator required._

- [ ] Memory injection into agent context — reads `memories` WHERE scope IN ('account', 'system') + member-scoped
- [ ] GM Chat: "remember that my members prefer..." → creates memory immediately (scope='account')
- [ ] Bootstrap LLM call on account connect: write `business_profile` memory + infer `business_type_tag`
- [ ] Settings UI: view / edit / delete active memories (with source badge: "You" vs "Agent")
- [ ] Memory active confirmation: task context shows "using N business memories"
- [ ] Memory expiry for time-sensitive facts
- [ ] Privacy enforcement: all account/member memories have `privacy_tier: 'account_private'`

**Depends on:** SI-1 (memories table). Partially done — existing `gym_memories` table and `getMemoriesForPrompt()` in `lib/db/memories.ts` need migration to the unified `memories` table.
**Files:** `lib/db/memories.ts` (rewrite to unified table), `components/SettingsPanel.tsx` (memory UI)

### SI-3 — Post-Task Evaluator (the engine)
_System generates its first automatic suggestions from completed interactions._

- [ ] `improvement_suggestions` table + migration
- [ ] `evaluation_rubrics` table + migration
- [ ] Post-task evaluator: `lib/eval/post-task-evaluator.ts`
  - Triggered async when task status → `resolved` or `cancelled`
  - Receives: full interaction record, conversation history, memories, outcome
  - Returns: 0–3 suggestions typed as memory / skill / rubric / prompt / calibration
  - Uses Haiku for routine evaluations, Sonnet for high-signal (unexpected outcome, owner edit, escalation)
- [ ] Evaluator prompt using the 5 output types (see System Prompt above)
- [ ] Weekly batch evaluator cron: `app/api/cron/evaluate-week/route.ts` (Sunday night)
  - Analyzes past 7 days per account as a group
  - Looks for patterns not visible in individual interactions
- [ ] Wire into task lifecycle: `updateTaskStatus()` → fire evaluator async (non-blocking)

**Depends on:** SI-1 (interaction_outcomes provides the data). SI-2 (memories are one of the output types).
**Files:** `lib/eval/post-task-evaluator.ts`, `lib/eval/prompts.ts`, `app/api/cron/evaluate-week/route.ts`, modify `lib/db/tasks.ts`

### SI-4 — Owner Review UI (closing the loop)
_Owner can review, accept, and apply suggestions. The agent earns trust._

- [ ] `/dashboard/improvements` page
- [ ] Suggestion cards with type-specific rendering and actions:
  - Memory: content preview, evidence summary → Dismiss / Save
  - Skill: applies_when, guidance preview, sources → Dismiss / Quick / Build
  - Rubric: criteria list, applies_to → Dismiss / Accept
  - Prompt: instruction text, target skill → Dismiss / Apply
  - Calibration: current vs suggested behavior, evidence → Dismiss / Confirm / Remind me later
- [ ] Filter by type (Memory, Skill, Rubric, Prompt, Calibration) and status (Pending, Applied, Dismissed)
- [ ] Confidence badge per card: Strong (green) / Moderate (amber) / Weak (gray)
- [ ] Evidence expandable section with outcome stats
- [ ] Badge count in nav: "Improvements (3)"
- [ ] Apply mechanics:
  - Accepted memories → created in `memories` table, immediately active
  - Applied prompts → stored as per-account skill override in `skills` table
  - Accepted rubrics → created in `evaluation_rubrics` table, active for future evaluations
  - Built skills → new skill file generated and stored in `skills` table

**Depends on:** SI-3 (evaluator produces the suggestions).
**Files:** `app/dashboard/improvements/page.tsx`, `app/api/improvements/route.ts`, `app/api/improvements/[id]/route.ts`

### SI-5 — Trust Gradient + Auto-Apply
_Proven improvements apply automatically. Owner stays informed._

- [ ] Account-level setting: `improvement_auto_apply_level` ('review_all' | 'auto_save_memories' | 'auto_apply_proven')
- [ ] Auto-apply logic in evaluator: check confidence + evidence_strength + account trust level
- [ ] For 'auto_apply_proven': also check if 3+ similar accounts already accepted the same pattern
- [ ] Weekly digest email via Resend: "Your agent learned N things this week" with one-click undo per item
- [ ] Auto-applied suggestions get `status: 'auto_applied'` — visible in improvements UI with undo
- [ ] Effectiveness tracking: compare outcomes before vs after a suggestion is applied

**Depends on:** SI-4 (review UI must exist before auto-apply makes sense).
**Files:** modify `lib/eval/post-task-evaluator.ts`, `app/api/cron/weekly-digest/route.ts`, modify settings UI

### SI-6 — Cross-Business Learning (the flywheel)
_Every business benefits from all businesses._

- [ ] Monthly cross-business cron: `app/api/cron/cross-business-eval/route.ts`
  - Reads `interaction_outcomes` across accounts (anonymized fields only — see privacy boundary)
  - Groups by `business_type_tag`
  - Generates suggestions with `privacy_tier: 'business_type_shared'` or `'system_wide'`
- [ ] Route suggestions to relevant accounts based on `business_type_tag` match
- [ ] "Learning Network" opt-in toggle in settings (Pro/Agency tier default on)
- [ ] Contribution transparency: "Your data contributed to N cross-business patterns this month"
- [ ] Minimum thresholds enforced: 3+ accounts for type-shared, 5+ across 2+ types for system-wide
- [ ] Cross-business memories stored with `scope: 'business_type'` or `scope: 'system'`

**Depends on:** SI-5 (trust gradient), business_type_tag populated on accounts (SI-2 bootstrap).
**Files:** `app/api/cron/cross-business-eval/route.ts`, modify `lib/db/memories.ts` (read system/type-scoped memories)

### SI-7 — Prompt A/B Testing (validation)
_Validate prompt improvements before fully applying them._

- [ ] Variant routing: similar interactions split between current and proposed prompt
- [ ] Outcome tracking per variant (stored in `interaction_outcomes`)
- [ ] Automatic promotion when variant outperforms at 80%+ confidence after 20+ samples
- [ ] Automatic retirement when variant underperforms
- [ ] Test results visible in improvements dashboard
- [ ] "A/B test this change" option when applying a prompt suggestion in SI-4 UI

**Depends on:** SI-4 (review UI), enough interaction volume for meaningful splits.

### Sequencing

```
SI-1 (signal collection) ─── do first, foundation for everything
  │
SI-2 (business memory) ──── can start in parallel with SI-1
  │                         partially done (existing gym_memories)
  │
SI-3 (post-task evaluator) ── after SI-1 + SI-2
  │
SI-4 (owner review UI) ───── after SI-3
  │
  ├── SI-5 (trust gradient) ── after SI-4
  │     │
  │     └── SI-6 (cross-business) ── after SI-5
  │
  └── SI-7 (A/B testing) ──── after SI-4, needs interaction volume
```

---

## What This Changes Over Time

**Today**: GymAgents is a well-built gym vertical product with hardcoded domain logic. It works well for PushPress gyms.

**After Phase 2**: The agent knows each specific business. Messages are noticeably more appropriate because they're informed by accumulated context, not generic prompts.

**After Phase 4**: The agent improves continuously. Owner feedback loops directly into better future interactions. The system surfaces patterns the owner didn't know they were creating.

**After Phase 6**: A new business joining gets the benefit of all prior learning. The system's understanding of "what at-risk looks like" is calibrated to evidence, not our assumptions.

**After Phase 7**: GymAgents is no longer a gym product with AI added. It's an AI business agent system that has deep context about gyms — because gyms have been teaching it. The same infrastructure works for any retention-critical business. The gym expertise is in the memories and patterns, not the code.

---

## Open Questions

1. **Evaluator cost at scale.** Running Claude on every task close adds inference cost. At scale: Haiku for initial pass, Sonnet only when the task has interesting signal (unexpected outcome, owner edit, pattern candidate). Budget: ~$0.01 per evaluation (Haiku), ~$0.05 per deep evaluation (Sonnet). At 500 accounts × 30 tasks/week = $60-150/month for evaluations.

2. **Memory conflicts.** If two memories contradict each other, resolution strategy needed. Options: recency wins, confidence wins, explicit owner resolution. Confidence decay prevents stale memories from persisting indefinitely. When the evaluator proposes a memory that conflicts with an existing one, the suggestion should explicitly reference the conflict: "This contradicts an existing memory: [X]. Proposed replacement."

3. **Over-fitting to unusual periods.** Memories accumulated during a seasonal spike or unusual cohort shouldn't permanently alter behavior. All memories need `last_confirmed_at` tracking and confidence decay. The weekly batch evaluator should check for memories that haven't been confirmed by recent outcomes and flag them for review.

4. **The edit signal is lossy.** We can detect "shortened message," "removed emoji," "changed opening line" — but we can't always infer *why*. Some signal will always be ambiguous. The evaluator should be calibrated to treat edit signal as suggestive, not definitive. Three consistent edits = weak. Five = moderate. Eight = strong.

5. **Cross-business learning without rigid types.** The flywheel uses freeform `business_type_tag` values rather than a rigid hierarchy. This means pattern density per tag matters — 5 accounts tagged `crossfit_gym` is enough for useful patterns. Semantic clustering (embedding similarity across business profiles) can improve routing as scale grows, but tags are sufficient for early stages.

6. **The evaluator evaluating the evaluator.** Suggestion quality degrades if the evaluator prompt is poorly calibrated. Track: acceptance rate (what % of suggestions get accepted), outcome delta (do accepted suggestions actually improve outcomes), and false positive rate (how many dismissed suggestions had "strong" confidence). Feed these metrics back into evaluator prompt tuning monthly.

7. **Cross-tenant skill sharing.** When the evaluator generates a skill suggestion from cross-business patterns, it could be useful across tenants — but the content might contain patterns learned from private interactions. The skill must be generated from anonymized structural patterns only, never from message content. The generating prompt should explicitly say: "You are writing a skill for other businesses. Do not reference any specific business, person, or message content."

8. **Rubric proliferation.** Without pruning, the system will accumulate rubrics that become contradictory or stale. Rubrics need an effectiveness score: if a rubric's criteria don't correlate with better outcomes after 30 days, flag it for review or auto-deactivate.
