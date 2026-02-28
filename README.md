# GymAgents

**AI-powered retention and revenue system for recurring-membership businesses.**

GymAgents runs autonomously in the background — watching member data, identifying who needs attention, drafting personalized outreach, sending it, and handling replies. The gym owner's job is to approve or escalate. Agents handle everything else.

Built on PushPress today. Architected for any business where clients pay monthly and disengage over time.

- **Live:** https://app-orcin-one-70.vercel.app
- **Supabase project:** `pmbqyetlgjnrpxpapfkf`

---

## How It Works

The core principle: **AI reasons about the domain. Code handles infrastructure.**

Three context layers feed every decision:

1. **Skill files** (`lib/task-skills/*.md`) — Natural language playbooks describing when a situation applies and how to approach it. The AI selects skills semantically; no hardcoded type→file mappings.
2. **Business memories** (`gym_memories` table) — Freeform facts about a specific business and its clients. Owner preferences, client notes, learned patterns. The AI reads these as context.
3. **Connector data** (`lib/pushpress-platform.ts`) — Raw member data from PushPress (visits, subscriptions, payments). Translated to abstract `MemberData` before reaching the agent layer.

**The analysis flow:**
```
PushPress data → Abstract MemberData[]
  → Claude: member summaries + skill files + business memories
    → Who needs attention, why, what type, what priority
      → Tasks created with AI-assigned types and goals
        → Skill files selected semantically for drafting
          → Outreach sent → replies handled → attribution closed
```

No scoring thresholds. No task type enums. No hardcoded cadences. The AI reasons about each situation in context.

---

## Features

### Agents
- **GM Agent** — conversational interface for the gym owner; orchestrates analysis, delegates to specialist agents, answers questions about members
- **Retention Agent** — detects at-risk members, drafts re-engagement outreach, handles the reply loop, closes or escalates
- **Agent sessions** — persistent, multi-turn conversations with tool use; three autonomy modes: `full_auto`, `semi_auto`, `turn_based`

### Skills
14 skill files covering: churn risk, win-back, onboarding, payment recovery, lead follow-up, lead reactivation, renewals, referrals, milestones, staff call, monthly analysis, and more. Each is a Markdown file with YAML front-matter (`applies_when`, `triggers`, `approach`). New situations = new skill files, not new code.

### Integrations (via Composio)
Connect third-party tools so agents can send messages across channels:
- **Slack** — OAuth
- **Gmail** — OAuth
- **Twilio** — API key (Account SID + Auth Token + From Number)
- 250+ more available through the Composio catalog

Composio handles token storage and OAuth flows. Connected tools are automatically injected into agent sessions as callable tools.

### Workflow Engine
TypeScript state machine configs stored in DB. Triggered by cron schedules or webhook events. See `WORKFLOWS.md`.

### Reply Loop
Every outbound email has `Reply-To: reply+{actionId}@lunovoria.resend.app`. Inbound webhook strips quoted text, routes to the reply agent. Claude evaluates: continue / close / escalate. Closes only on concrete commitment; escalates vague deflections.

### Business Memories
Freeform key-value store per account. Captures owner preferences ("sign off as Coach Mike"), client facts ("Alex prefers morning classes"), and learned patterns. Injected into every agent prompt as context.

### Demo Mode
Visitor enters name + email → becomes the first member card → real email delivered to their inbox in ~30 seconds. Fully sandboxed per session.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router |
| Database | Supabase (Postgres) |
| AI | Anthropic Claude — Sonnet 4.6 (reasoning) + Haiku 4.5 (drafting) |
| Email | Resend (outbound + inbound webhooks) |
| Integrations | Composio (OAuth flows, token storage, 250+ tools) |
| Search | Serper (Google results for web_search tool) |
| Payments | Stripe |
| Deployment | Vercel — push to `main` → auto-deploy |
| Tests | Vitest (688 tests, 46 files) + Playwright (E2E) |

AI model constants are centralized in `lib/models.ts` — never hardcode model strings.

---

## Project Structure

```
app/
  api/
    agents/             # Agent CRUD, run, toggle, sessions, chat
    integrations/       # Composio OAuth + API key flows, callback handler
    autopilot/          # Approve/dismiss actions
    webhooks/           # PushPress events, Resend inbound email
    demo/               # Demo mode endpoints
    cron/               # Scheduled job triggers
    ...
  dashboard/
    [[...section]]/     # Main app UI — section-based routing
                        # /dashboard, /dashboard/agents, /dashboard/skills, etc.

components/             # React components
  AppShell.tsx          # Sidebar nav, layout shell
  AgentChat.tsx         # Agent session UI with runs history
  IntegrationsPanel.tsx # Connect/disconnect integrations
  ReviewQueue.tsx       # Pending action approval queue
  ...

lib/
  agents/
    session-runtime.ts  # Core agent loop — tool use, autonomy modes, DB persistence
    GMAgent.ts          # GM agent implementation
    RetentionAgent.ts   # Retention agent implementation
  task-skills/          # 14 skill files with YAML front-matter
  integrations/
    composio.ts         # Composio client, OAuth/API key helpers, tool injection
    registry.ts         # Integration definitions (id, authType, fields)
  db/                   # DB helpers: accounts, tasks, commands, memories, integrations
  pushpress-platform.ts # PushPress connector (PP types stay here)
  skill-loader.ts       # Skill loading + semantic selection
  reply-agent.ts        # Inbound reply evaluation
  workflow-runner.ts    # Workflow state machine
  models.ts             # AI model constants (SONNET, HAIKU)
  __tests__/            # Vitest tests (688 across 46 files)

docs/
  AI-NATIVE-ARCHITECTURE.md   # Core design doc — read before adding domain logic
  SELF_IMPROVING_SYSTEM.md    # Cross-business learning flywheel
  VISION.md                   # Product strategy and north star
  INTEGRATIONS.md             # Integration system design

lib/migrations/         # 020 Supabase SQL migrations
e2e/                    # Playwright browser tests
BRAND.md                # Design system — read before writing UI
CLAUDE.md               # AI assistant instructions for this codebase
```

---

## Local Development

```bash
npm install
cp .env.local.example .env.local   # fill in values from Vercel or team
npm run dev                         # → http://localhost:3000
```

**Never run `npm run dev` in CI or automated contexts.** Use `npm run build` to validate.

### Commands

```bash
npm run dev           # dev server → localhost:3000
npm run build         # production build (use this to validate changes)
npm run test          # vitest run (all 688 tests)
npm run test:watch    # vitest watch mode
npm run test:e2e      # Playwright E2E (headless)
npm run test:coverage # coverage report (target: 80%+)
npm run lint          # eslint
npm run cron          # trigger all cron jobs once locally
npm run cron:watch    # run crons on their schedules
npm run dev:sync      # re-sync ngrok URL after new tunnel session
```

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server only) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `RESEND_API_KEY` | Resend email API key |
| `RESEND_FROM_EMAIL` | Sending address (e.g. `agents@yourdomain.com`) |
| `COMPOSIO_API_KEY` | Composio integration platform key |
| `PUSHPRESS_API_KEY` | PushPress platform API key |
| `PUSHPRESS_COMPANY_ID` | PushPress company ID |
| `PUSHPRESS_PLATFORM_URL` | PushPress API base URL |
| `NEXT_PUBLIC_APP_URL` | Public app URL (for OAuth callbacks) |
| `JWT_SECRET` | Session signing secret |
| `ENCRYPTION_KEY` | Field-level encryption key |
| `CRON_SECRET` | Vercel cron job authorization header |
| `SERPER_API_KEY` | Google search via Serper (for web_search tool) |
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_STARTER_PRICE_ID` | Stripe price ID — starter plan |
| `STRIPE_PRO_PRICE_ID` | Stripe price ID — pro plan |
| `GOOGLE_CLIENT_ID` | GCP OAuth (Gmail direct integration) |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth secret |
| `DEMO_MODE` | `true` to enable demo gate |
| `LINEAR_API_KEY` | Linear issue tracker (optional) |
| `LINEAR_TEAM_ID` | Linear team ID (optional) |

---

## Testing

Tests are mandatory — every feature ships with tests.

```bash
npm run test              # run all unit tests
npm run test:watch        # TDD watch mode
npm run test:e2e          # Playwright E2E against localhost
npm run test:coverage     # coverage report
```

- **Vitest** — unit tests for lib/, API routes, agent classes. All in `lib/__tests__/`.
- **Playwright** — browser E2E for critical user flows. All in `e2e/`.
- Pattern: factory functions (`makeTask()`, `makeDeps()`) + `vi.mock()` for Supabase/Anthropic/Resend.

---

## Deployment

Push to `main` → Vercel auto-deploys.

- **Live:** https://app-orcin-one-70.vercel.app
- **Supabase:** `pmbqyetlgjnrpxpapfkf`

To run a new DB migration: apply the SQL in `lib/migrations/` via the Supabase dashboard or CLI.

---

## Key Design Decisions

**Before adding any domain logic, ask: should the AI be reasoning about this?**

- Scoring thresholds (`if daysSinceCheckin > 14`) → belong in the AI prompt, not in code
- New task types → freeform labels the AI assigns; skill files are selected semantically
- Event-specific handlers (`case 'member.cancelled':`) → the AI evaluates events in context
- Message cadences (day 0, day 3, day 10) → AI-driven per situation, not hardcoded
- Business-specific language in agent classes → belongs in skill files and memories

See `docs/AI-NATIVE-ARCHITECTURE.md` for the full design doc and new code checklist.
