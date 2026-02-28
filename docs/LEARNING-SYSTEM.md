# Learning System — Design Plan

A design document for the GymAgents self-improvement pipeline. This is a reference for engineers building the system — decisions made, architecture planned, build order defined.

---

## Context

GymAgents already has the scaffolding for learning:

- `gym_memories` table — freeform facts about a business and its members, injected into AI prompts
- `improvement_suggestions` table + API — pending suggestions awaiting owner approval
- `suggest_improvement` tool — AI can propose memory/prompt/skill changes with a confidence score
- `outcomeScore`, `outcome` (engaged/churned/escalated), `resolved` on every conversation evaluation
- Attribution tracking (did member return in 14 days?) — not yet connected to learning
- Session runtime + tool system in `lib/agents/tools/`
- Skill files in `lib/task-skills/*.md` — natural language playbooks with YAML front-matter

The learning system connects these pieces into three distinct feedback loops.

---

## Guiding Decisions

### Confidence + Owner Approval — Always

- Every improvement suggestion carries a confidence score
- All suggestions require owner approval before taking effect — no silent learning
- Track every approval and dismissal with metadata: `suggestion_type`, `confidence_score`, `source`, `account_id`, `approved_at`, `dismissed_reason`
- Goal: learn what to auto-approve from patterns over time — build that later, not now

### Improvements Is Its Own Section

- Dedicated nav item and section in the app
- Not a dashboard widget — it's a distinct workflow: review what the system learned, approve or dismiss
- Treat it like an inbox, not a sidebar card

### GM Is Just Another Agent

- The GM chat is not a special case
- An agent = skill set + memory set + chat interface
- GM agent is general-purpose; retention agent is specialized; same infrastructure
- Whatever the GM learns in chat flows through the same `suggest_improvement` pipeline

### Attribution = Separate Track

- Attribution needs its own DB table and mental model before it can feed learning
- Not part of this plan — build it separately, then wire it into learning later
- The table must answer: what action was taken, what was the outcome, over what time window, which agent/skill handled it

---

## The Three Learning Loops

### Loop 1 — In-Session / Post-Session Learning

- **Signal:** Direct corrections in chat ("no, never do that"), implicit preferences from how the owner interacts
- **Capture point:** End of chat session — one analysis pass over the full session, not turn-by-turn
- **Source tag:** `direct_correction`
- **Output:** `improvement_suggestions` with high confidence
- Rationale: context is hot at end-of-session, a single pass is cheaper and less noisy than per-turn analysis

### Loop 2 — Post-Completion Retrospective

- **Signal:** Full task history — messages sent, edits made by the owner, outcome, time to resolution
- **Capture point:** When a task is marked completed
- **Trigger:** Automated job, runs once per completed task
- **Source tag:** `retrospective`
- **Output:** `improvement_suggestions` — skips signals already captured from the same session as `direct_correction`
- Rationale: retrospective has access to the full arc of a task, not just the chat; edit diffs are most valuable here

### Loop 3 — Attribution-Driven (future)

- **Signal:** Did the action actually work? Member returned, paid, reactivated?
- **Capture point:** After attribution window closes (e.g. 14 days post-outreach)
- **Depends on:** Attribution table being designed and built first (separate track)
- **Source tag:** `outcome`
- **Output:** `improvement_suggestions` tied to skill effectiveness or message approach

---

## Key Learning Signals

### Edit/Diff Signal (highest value)

- When a GM edits an AI draft before sending, capture: original draft, final sent version, character-level diff
- If edits are consistent across sessions (always shorter, always more direct, removes certain phrases), generate a tone/style preference suggestion
- Example: "AI wrote 4 paragraphs, GM consistently trims to 2 sentences" → suggest memory: "keep outreach brief and direct"
- The diff is the correction — the owner doesn't need to say anything explicitly
- Store on the outbound email record: `original_draft`, `sent_version`

### Dismissed Task Signal

- When the GM skips or dismisses tasks, record it
- 3+ dismissals of the same type or pattern → suggest a memory: "this business doesn't prioritize win-back campaigns"
- Consistent apathy toward a task type means the agent is mis-calibrated for this account

### Direct In-Chat Corrections

Examples of what to capture:
- "Never mention pricing in initial outreach"
- "Whenever I ask for a check-in email it means a quick 2-liner"
- "Sign off as Coach Mike, not the gym name"

Captured end-of-session, high confidence, `direct_correction` source. No volume guard — one instance is enough.

### Tone and Writing Style

- If the owner consistently rewrites AI copy in a recognizable style, extract that style as a memory
- Example: "Owner prefers casual tone, contractions, short sentences, no em dashes"
- Builds a per-account voice profile over time from the edit/diff signal

---

## Memory Model

### Memory Scoping — Current and Planned

Current scope types: `global` (account-level), `member` (per-member)

Planned additions:
- **Per-member** — "Alex has a knee injury, prefers morning classes, responds to direct asks"
- **Per-class/program** — "Saturday intro class fills fast, mention it early with new leads"
- **Per-plan/membership-type** — "Unlimited members churn when they stop attending for 3+ weeks"
- **Per-skill** — business-specific notes that extend a skill's behavior (already built as skill customizations)

Implementation: `scope` field on memories handles this (`global`, `member`, `class`, `plan`) with an associated `scope_id` (the member ID, class ID, etc.).

### Memory Conflict Resolution

- On any write (create or update), the AI scans all existing memories in the same scope
- If conflicting information exists: new information wins, old information is removed
- No complex merging — last signal wins
- The improvement suggestion carries: target memory ID (if updating) or null (if new), proposed content, reason for the change
- Owner approves → system applies

### Memory Decay

- Memories need `review_after` timestamps — not hard expiry, a soft flag for re-verification
- Problem: multiple facts can be stacked in one memory card — a single expiry date doesn't cleanly apply per fact
- When injecting memories into prompts, flag stale memories differently or exclude them past a threshold
- A periodic job surfaces stale memories in the Improvements section: "This memory is 6 months old — still accurate?"
- Staleness window varies by category: member-personal facts (injury, preference) decay faster than account-level preferences

---

## Double-Learning Prevention

Three mechanisms to avoid duplicate or conflicting suggestions:

1. **Source tagging** — every suggestion marked with: `direct_correction`, `retrospective`, `outcome`, or `pattern`
2. **End-of-session pass priority** — captures in-chat corrections while context is hot; retrospective skips anything already captured as `direct_correction` for the same session
3. **Deduplication check** — before inserting a new suggestion, check source + content hash against existing open suggestions for the same account

---

## Volume Guard

- Pattern-type suggestions (`pattern` source) require a minimum of 3 occurrences before generating a suggestion
- Exception: if the signal is strong on first occurrence, surface it in the Improvements section as a question ("we noticed X — is this a preference?") rather than a confirmed suggestion
- Direct corrections (`direct_correction` source) are high-confidence from one instance — no volume guard

---

## Skills

### AI Can Propose Skill Updates

- Beyond per-account customization notes, the AI can propose changes to a skill's approach
- These go through the same improvement pipeline — owner approves before any skill content changes
- Treat skill updates as high-confidence suggestions — they are structural changes that affect all future behavior using that skill

### Skills from External Best Practices (future)

- Many skills could be informed by internet best practices: sales methodology, lead nurturing, objection handling, email writing
- Future: a research agent mode can search for best practices and propose a new skill or update an existing one
- Example: "research best practices for gym lead follow-up sequences" → propose updated `lead-followup.md`
- Requires web search capability and the research agent being built first

---

## What We Are Not Building Now

- **Rollback / audit trail** — skipping for now; too complex, adds confusion. May revisit.
- **Auto-approval** — all suggestions require owner approval. Patterns that indicate safe auto-approval are a future layer.
- **Attribution-driven learning** — attribution table must be designed and built first (separate track).
- **Bootstrapping from onboarding** — add to build list, ask questions when we get there.
- **Skills from external research** — requires research agent and web search, ask questions when we get there.

---

## Build Order

| # | Item | Notes |
|---|------|-------|
| 1 | **Improvements section** | Nav item, dedicated page, approve/dismiss UI (API already exists) |
| 2 | **Approval tracking** | Store resolution metadata on every approval/dismissal |
| 3 | **Edit/diff capture** | Store `original_draft` + `sent_version` on outbound email records |
| 4 | **Dismissed task signal** | Record task dismissals, feed into volume guard |
| 5 | **Post-session learning pass** | End-of-session analysis for corrections and preferences |
| 6 | **Post-completion retrospective** | Triggered on task completion, analyzes full task history |
| 7 | **Memory decay** | `review_after` field, staleness detection, periodic review surfacing |
| 8 | **Memory scoping expansion** | Per-class and per-plan scope types |
| 9 | **Volume guard** | 3-occurrence threshold for pattern suggestions; single-occurrence surfacing as questions |
| 10 | **Conflict resolution scan** | On every memory write, scan and remove conflicting content |
| 11 | **AI skill proposals** | `suggest_improvement` tool can propose skill updates |
| 12 | **Attribution table** | Separate design spike — ask questions when we get here |
| 13 | **Attribution → learning connection** | Wire outcome signals into Loop 3 once attribution is built |
| 14 | **Skills from external best practices** | Web research → skill proposals — ask questions when we get here |
| 15 | **Bootstrapping** | Pre-populate memories from onboarding conversation — ask questions when we get here |
| 16 | **Cross-business learning** | v2 — anonymized patterns across accounts. Architecture already supports it (`account_id` scoping). Needs ~50+ businesses before signal is meaningful. Revisit then. |
