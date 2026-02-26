# GymAgents Self-Improving System

_How the system gets smarter with every interaction — and why this is the mechanism by which we escape hardcoded domain logic._

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
-- Freeform knowledge about a connected business
-- Not typed to gym concepts — works for any vertical
CREATE TABLE business_memories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id),
  content         text NOT NULL,         -- freeform: the AI writes this, the AI reads this
  category_hint   text,                  -- soft label: 'preference' | 'context' | 'pattern'
                                         -- AI-generated, not enforced — informational only
  confidence      decimal DEFAULT 0.7,   -- how well-evidenced is this
  source          text,                  -- 'evaluator' | 'owner_edit' | 'gm_chat' | 'manual'
  source_task_ids uuid[],
  created_at      timestamptz DEFAULT now(),
  last_confirmed_at timestamptz DEFAULT now(),
  expires_at      timestamptz            -- null = permanent; set for time-sensitive facts
);

-- Pending suggestions from evaluator analysis
-- The type field is AI-generated, not an enforced enum
CREATE TABLE improvement_suggestions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid REFERENCES accounts(id),  -- null = cross-business
  suggestion_type  text NOT NULL,   -- AI chooses: 'memory' | 'prompt_update' | 'calibration' |
                                    -- 'new_skill' | 'timing_pattern' — open set, not enum
  title            text NOT NULL,
  description      text NOT NULL,   -- written by AI for the owner to read and evaluate
  proposed_change  jsonb NOT NULL,  -- structured enough to apply; flexible enough to be general
  evidence         jsonb NOT NULL,  -- {task_ids, outcome_stats, reasoning, sample_interactions}
  confidence_score decimal NOT NULL,
  evidence_strength text NOT NULL,  -- 'strong' | 'moderate' | 'weak'
  status           text DEFAULT 'pending',
  source           text NOT NULL,   -- 'post_task_eval' | 'weekly_batch' | 'cross_business' | 'edit_analysis'
  related_task_ids uuid[],
  created_at       timestamptz DEFAULT now(),
  reviewed_at      timestamptz,
  applied_at       timestamptz
);

-- Raw signal: message style + verifiable outcome pair
-- No gym-specific fields — works for any business/member/interaction type
CREATE TABLE interaction_outcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts(id),
  task_id          uuid NOT NULL REFERENCES agent_tasks(id),
  interaction_type text NOT NULL,     -- AI-generated description, not hardcoded type
  context_summary  text,              -- AI-authored summary of the situation
  message_sent     text,              -- what was sent
  outcome          text,              -- 'engaged' | 'recovered' | 'churned' | 'unresponsive'
  days_to_outcome  integer,
  attributed_value decimal,
  owner_edited     boolean DEFAULT false,
  edit_summary     text               -- AI-authored summary of what changed and why it might matter
);
```

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

Generate improvement suggestions when:
  - A clear pattern is emerging (even if one data point — flag as 'weak')
  - The outcome was unexpectedly good or bad
  - The owner's edits reveal an implicit preference we didn't know about
  - The interaction reveals something about this business we should remember

Do NOT generate suggestions for:
  - Expected outcomes with no new signal
  - Situations where one data point is ambiguous
  - Anything involving safety, compliance, or infrastructure

Return a JSON array. Each suggestion must include:
  - suggestion_type (your categorization — open, not constrained)
  - title (short, specific, owner-readable)
  - description (what you learned and why it matters)
  - proposed_change (structured: what to actually change)
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
  (no PII — interaction_type, message_style, outcome, business_context_tags)
             ↓
  Cross-business pattern detection
  (requires 3+ businesses, monthly cadence)
             ↓
  Suggestions routed to relevant businesses
  ("CrossFit gyms: October is highest churn month — pre-emptive outreach in September")
             ↓
  Owner accepts → improves base context for that business type
             ↓
  New businesses of that type start with better priors
             ↓
  More businesses → more signal → better patterns
```

This is the compound moat. After 6 months with 50 connected businesses:
- 90,000+ labeled interaction-outcome pairs
- Calibrated risk thresholds per business type — not our assumptions, evidence
- Proven message patterns by segment, timing, audience type
- A new business joining immediately benefits from all of it

No competitor can acquire this without also acquiring the customer relationships. The advantage compounds weekly. And because the architecture is abstract — not gym-specific — this flywheel works equally for the next vertical we enter.

---

## Implementation Roadmap

### Phase 1 — Signal Collection (2 weeks)
_No visible changes to owners. Start building the data needed to learn._

- [ ] `interaction_outcomes` table — populate on every task close (AI-authored context summary)
- [ ] Capture owner edit diffs on manual approval — run through Claude for `edit_summary`
- [ ] `business_memories` table (schema only — not yet populated automatically)
- [ ] Log dismissals with optional owner annotation
- [ ] Ensure task outcomes are reliably attributed before learning from them

### Phase 2 — Business Memory (2 weeks)
_Owners can teach the system about their business. Immediate value, no evaluator required._

- [ ] Memory injection into agent context (`buildAgentContext()`)
- [ ] GM Chat: "remember that my members prefer..." → creates memory immediately
- [ ] Settings UI: view / edit / delete active memories
- [ ] Memory active confirmation: task context shows "using 3 business memories"
- [ ] Memory expiry for time-sensitive facts

### Phase 3 — Post-Task Evaluator (3 weeks)
_System generates its first automatic suggestions from completed interactions._

- [ ] `improvement_suggestions` table
- [ ] Post-task evaluator (async, runs on `TaskCompleted` event)
- [ ] Domain-agnostic evaluator prompt (see above)
- [ ] Confidence scoring and evidence packaging
- [ ] Weekly batch evaluator (Sunday night cron)
- [ ] Badge count in nav: "Improvements (3)"

### Phase 4 — Owner Review UI (2 weeks)
_Owner can review, accept, and apply suggestions. Closes the loop._

- [ ] `/dashboard/improvements` page
- [ ] Suggestion cards with expandable evidence
- [ ] Accept / Dismiss / Remind me later
- [ ] Accepted memories immediately active in next agent run
- [ ] Applied prompt updates staged for A/B testing (Phase 5)

### Phase 5 — Prompt A/B Testing (4 weeks)
_Validate prompt improvements before fully applying them._

- [ ] Variant routing: similar interactions split between current and proposed prompt
- [ ] Outcome tracking per variant
- [ ] Automatic promotion when variant outperforms at 80%+ confidence
- [ ] Automatic retirement when variant underperforms
- [ ] Test results visible in improvements dashboard

### Phase 6 — Cross-Business Learning (4 weeks)
_Every business benefits from all businesses. The flywheel becomes real._

- [ ] Anonymized signal aggregation pipeline (monthly)
- [ ] Cross-business pattern detection (3+ business minimum)
- [ ] Suggestions routed to relevant businesses with source context
- [ ] "Learning Network" opt-in (Pro/Agency tier default on)
- [ ] Contribution transparency: "Your data contributed to 3 cross-business patterns"

### Phase 7 — Loosening the Domain Model (ongoing)
_Replace hardcoded gym logic with AI reasoning guided by context._

Sequenced refactors, in order of impact:

1. **Risk scoring** — replace `scoreChurnRisk()` heuristics with AI analysis given member data + business context. Keep scoring as a fallback until AI is proven more accurate.
2. **Task types** — make `task_type` a hint the AI writes, not a category that drives behavior. Tasks become goal-driven objects.
3. **Analysis loop** — replace the 5 hardcoded insight formulas in `analyzeGym()` with a single AI call: "here's all the data for this business — what needs attention and why?"
4. **Entity abstraction** — introduce `BusinessEntity` and `EngagementEvent` as the core types; `PPCustomer` and `PPCheckin` become one implementation of these.
5. **Event handling** — replace `_handleStatusChanged()` specific handlers with an AI evaluator: "this event happened — does it require action?"

Each phase is independently deployable and testable. None requires tearing out the existing system — they're incremental replacements with the old code as fallback.

---

## What This Changes Over Time

**Today**: GymAgents is a well-built gym vertical product with hardcoded domain logic. It works well for PushPress gyms.

**After Phase 2**: The agent knows each specific business. Messages are noticeably more appropriate because they're informed by accumulated context, not generic prompts.

**After Phase 4**: The agent improves continuously. Owner feedback loops directly into better future interactions. The system surfaces patterns the owner didn't know they were creating.

**After Phase 6**: A new business joining gets the benefit of all prior learning. The system's understanding of "what at-risk looks like" is calibrated to evidence, not our assumptions.

**After Phase 7**: GymAgents is no longer a gym product with AI added. It's an AI business agent system that has deep context about gyms — because gyms have been teaching it. The same infrastructure works for any retention-critical business. The gym expertise is in the memories and patterns, not the code.

---

## Open Questions

1. **Evaluator cost at scale.** Running Claude on every task close adds inference cost. At scale: Haiku for initial pass, Sonnet only when the task has interesting signal (unexpected outcome, owner edit, pattern candidate).

2. **Memory conflicts.** If two memories contradict each other, resolution strategy needed. Options: recency wins, confidence wins, explicit owner resolution. Confidence decay prevents stale memories from persisting indefinitely.

3. **Over-fitting to unusual periods.** Memories accumulated during a seasonal spike or unusual cohort shouldn't permanently alter behavior. All memories need `last_confirmed_at` tracking and confidence decay.

4. **The edit signal is lossy.** We can detect "shortened message," "removed emoji," "changed opening line" — but we can't always infer *why*. Some signal will always be ambiguous. The evaluator should be calibrated to treat edit signal as suggestive, not definitive.

5. **Cross-business learning needs scale first.** The flywheel argument requires 10–15 businesses minimum before cross-business patterns are statistically meaningful. Before that threshold: gym-specific learning only, which is still valuable. Don't over-promise the network effect until it exists.

6. **The evaluator evaluating the evaluator.** Suggestion quality degrades if the evaluator prompt is poorly calibrated. This is a meta-learning problem — we need a way to measure whether accepted suggestions actually produced better outcomes, and feed that back into evaluator calibration. Phase 5's A/B testing is the initial mechanism. Long-term, this is a deeper challenge.
