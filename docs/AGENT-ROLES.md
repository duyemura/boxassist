# Agent Roles Architecture

## The Big Idea

The system is evolving from **task-based agents** to **role-based agents**.

Today the system thinks in tasks: "someone needs a churn-risk email, run the churn-risk skill." The next architecture thinks in roles: "there's a Front Desk person and a GM, each with a job description, authority limits, and a defined handoff between them."

This is the right model because:
- **Gym owners already think this way.** "I need a front desk person" is a concept they have. "I need a churn-risk task pipeline" is not.
- **Boundaries emerge naturally.** A front desk person doesn't set refund policy. You don't need to encode that — it's part of the role description.
- **Depth per role.** A front desk agent that handles one channel is useful. One that handles email + SMS + Instagram + voice + WhatsApp with consistent memory across all of them is irreplaceable.
- **Scales cleanly.** New roles (Sales, Billing, Head Coach) are new Markdown role files + agent configs, not new code paths.

---

## The Org Chart

```
Owner
  └── GM Agent              ← strategy, oversight, exception authority
        └── Front Desk Agent ← all member/lead communication, all channels
        └── [Sales Agent]    ← lead conversion (future)
        └── [Billing Agent]  ← payment recovery (future)
        └── [Coach Agent]    ← programming/performance (future)
```

The GM directs and the Front Desk executes. Front Desk escalates anything outside its authority to the GM. The GM handles exceptions and escalates to the human owner for anything that requires a real decision.

---

## Role Definition Files

Role files live in `lib/roles/`. They are Markdown with YAML front-matter — the same pattern as skill files, but at a higher level of abstraction. A role file is essentially a job description that the AI reads as its identity for a session.

```
lib/
  roles/
    front-desk.md      ← full role definition
    gm.md              ← full role definition
  task-skills/         ← situation-specific playbooks (still used by roles)
```

The YAML front-matter defines the structural config; the Markdown body is the full natural-language role description, responsibilities, boundaries, tone guide, and escalation playbook.

```yaml
---
id: front-desk
title: Front Desk Agent
reports_to: gm
escalate_to: gm
channels: [email, sms, whatsapp, instagram, facebook, voice, chat]
autonomy: semi_auto
---
```

---

## Front Desk Agent

### Purpose
First point of contact for all inbound member and lead communication. Handles everything a skilled front desk employee would handle — across every channel, with consistent voice and full member context.

### Responsibilities

**Inbound (member-initiated):**
- Answer questions: hours, pricing, class schedule, membership options, cancellation policy, what to bring to first class
- Handle complaints: acknowledge, de-escalate, resolve if within authority, escalate if not
- Process requests: membership holds, class bookings, guest passes
- Respond to replies from outbound campaigns
- Handle social DMs (Instagram, Facebook)
- Handle voice calls: answer, triage, handle or route
- Handle WhatsApp and SMS conversations

**Outbound (agent-initiated):**
- New member welcome sequence
- Class reminders and confirmations
- Routine payment reminders (not recovery — that escalates)
- Birthday messages, milestone acknowledgments
- First 1-2 re-engagement touches (further touches go to Retention)

### What the Front Desk Knows
- **The gym:** name, location, hours, staff names, class schedule, pricing, policies, vibe, what makes it special — all from business memories
- **Each member:** tenure, preferences, usual classes, any known life context, membership status — from connector data + member memories
- **Conversation history:** what was said last time, across any channel — from the conversations table
- **Current context:** just signed up? just missed three weeks? just had a payment fail? — from event data

### Tone
- Warm but not gushing — a great front desk person, not a chatbot
- Consistent across channels — same voice on email as on Instagram DMs
- Calibrates length to channel: brief on SMS, fuller on email
- Never makes up facts about the gym. If uncertain: "Let me check on that for you."

### Authority Limits — What Front Desk CANNOT Do

| Situation | Action |
|---|---|
| Member requests a refund | Escalate to GM |
| Member wants to cancel | Handle initial conversation warmly; escalate final decision to GM |
| Request for membership exception (freeze, rate discount) | Escalate to GM |
| Complaint about a coach or class | Acknowledge + escalate to GM |
| Legal or liability mention ("I got hurt") | Stop immediately, escalate, do not respond further |
| Question about another member | Deflect warmly, never engage |
| Policy questions outside standard knowledge | "Let me get you a proper answer on that" → escalate for info |
| Hostile or abusive contact | Escalate immediately, do not respond |
| Any financial commitment beyond standard pricing | Escalate to GM |
| Outreach requiring more than 2 touches with no response | Hand off to Retention skill path |

### Escalation Protocol
When escalating to GM, Front Desk should always include:
1. Member name and context (tenure, status)
2. The conversation summary (what they said, what Front Desk said)
3. Why it's being escalated (specific boundary hit)
4. Recommended action if Front Desk has a view

---

## GM Agent

### Purpose
Strategic oversight, exception handling, and orchestration. The GM doesn't do front desk work — they direct it, review it, and handle what front desk cannot.

### Responsibilities

**Strategic:**
- Daily/weekly member health analysis — who's at risk, what's trending
- Plan and trigger retention campaigns, win-back pushes, referral programs
- Monitor what Front Desk is handling; course-correct when needed
- Review and approve outreach for high-value or high-risk situations

**Exceptions (from Front Desk escalations):**
- Approve or deny refunds
- Handle cancellation conversations
- Respond to coach/class complaints
- Answer policy questions that require judgment
- Handle any legal or serious situations

**Conversational:**
- The owner talks to the GM when they want a briefing, have a question, or want to change something
- Can receive directives: "When someone mentions cancelling, always have me follow up personally"
- Turns those directives into memories that Front Desk follows

**Coordination:**
- Routes work to the right role ("this is a billing issue, flag for billing agent")
- Can delegate back to Front Desk with specific instructions

### Authority Limits — What GM Does NOT Do
- Answer routine inbound messages — that's Front Desk
- Handle things that should stay with a human (membership termination for serious cause, legal action)
- Make coaching or programming decisions — that's a Coach Agent (future)
- Do work that's below its level when Front Desk can handle it

### The GM ↔ Front Desk Relationship
```
GM sets direction     →    Front Desk executes
Front Desk escalates  →    GM decides
GM overrides          →    Front Desk adjusts
```

---

## The Channel Architecture

### The Key Abstraction: Conversations, Not Messages

Front Desk thinks in **conversations**, not channels. A conversation is a thread with a member or lead that may span multiple channels over time. If a member emails Monday and texts Wednesday, that's one conversation. The agent has full context across both.

```
conversations
  id, account_id, contact_id
  channel: email | sms | whatsapp | instagram | facebook | voice | chat
  status: open | resolved | escalated | waiting_member | waiting_agent
  assigned_role: front_desk | gm | human
  messages: [{ direction, content, timestamp, channel_used }]
  context: { member_summary, escalation_reason, ... }
```

### Channel Connectors

| Channel | Status | Path |
|---|---|---|
| Email | ✓ Live | Resend (outbound) + inbound webhook |
| SMS | ✓ Live | Twilio via Composio |
| WhatsApp | Planned — next | Twilio WhatsApp API (same Twilio account) |
| Instagram DMs | Planned | Meta API or Composio |
| Facebook DMs | Planned | Meta API or Composio |
| Voice | Future | Vapi.ai or Bland.ai |
| Live chat | Future | Custom websocket or Crisp |

All channels funnel into the `conversations` table. Channel is delivery metadata — the agent doesn't change its reasoning based on whether it's email or WhatsApp.

---

## What Needs to Be Built

### Exists — Reusable As-Is
- Session runtime (agent loop, tool use, autonomy modes)
- Skills system (semantic selection, YAML front-matter) — Front Desk loads relevant skills per situation
- Memories system — role-specific memories and member memories
- Email channel (Resend in + out)
- SMS channel (Twilio via Composio)
- Reply loop (inbound → agent)

### Needs to Be Built

**1. `lib/roles/` directory**
Role definition files for `front-desk.md` and `gm.md`. These are the most important artifacts — get them right first. The quality of these files determines the quality of the agents.

**2. `conversations` table**
Unified cross-channel thread model. Migration + DB helpers. Foundation for everything else.

**3. Channel routing layer**
Inbound message (any channel) → identify channel + member/contact → find or create conversation → route to assigned agent.

**4. Role-aware agent runtime**
Extension to `session-runtime.ts` that loads a role file as the agent's identity (vs. skill files which are situational). The role file becomes Layer 0 of the prompt stack; skill files are still loaded contextually on top.

**5. Escalation protocol**
When Front Desk hits a boundary: create a task for GM with full context summary. GM picks it up in its queue.

**6. GM oversight interface**
GM can see open Front Desk conversations, read summaries, override decisions, inject directives.

**7. WhatsApp connector**
Third channel after email + SMS. Proves the multi-channel model.

---

## Build Order

1. **Write the role files** — `lib/roles/front-desk.md` and `lib/roles/gm.md`. Natural language job descriptions. No code yet.
2. **`conversations` table** — the data foundation everything else requires.
3. **Wire existing channels into conversations** — email + SMS inbound now create/update conversations.
4. **Front Desk Agent v1** — email + SMS only. Role-aware runtime. Full member context. No voice/social yet.
5. **Escalation path** — Front Desk → GM handoff with context.
6. **GM oversight** — GM reads open conversations, can override.
7. **WhatsApp** — third channel, validates the multi-channel abstraction.
8. **Social DMs** — Instagram + Facebook via Composio.
9. **Voice** — Vapi.ai integration. Biggest lift, most impactful.

---

## Design Principles (Unchanged)

The role-based architecture is an evolution, not a departure from the existing AI-native design:

- **AI reasons about domain, code handles infrastructure** — the role file tells the AI who it is and what it can do; the AI still makes every domain decision
- **No hardcoded domain logic** — role boundaries are described in natural language in role files, not encoded as if/else
- **Skill files still apply** — a Front Desk Agent handling a potential churn situation still loads the `churn-risk` skill; the role defines identity, skills define situational approach
- **Memories still apply** — business memories (owner preferences, member facts) are injected into every role's prompt just as they are today
- **New roles = new files** — adding a Sales Agent or Billing Agent means writing a new role file and wiring it up, not modifying agent infrastructure code
