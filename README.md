# GymAgents

**AI General Manager for boutique gyms.** GymAgents increases gym revenue and reduces churn through proactive execution — not dashboards and reports.

Built for [PushPress](https://pushpress.com) gyms.

---

## What It Does

GymAgents runs autonomously in the background. It watches your member data, identifies at-risk members, drafts personalized outreach, sends it, and handles replies — all without the gym owner lifting a finger.

**MVP scope: Retention + Sales**

- **Retention Agent** — detects members who haven't checked in recently, drafts re-engagement emails, handles the reply loop, closes or escalates based on response
- **Sales Agent** — works leads and trial members toward conversion
- **GM Agent** — orchestrates both agents, dispatches tasks, surfaces what needs human attention

---

## Architecture

### Agent Hierarchy
```
GM Agent (dispatch + oversight)
├── Retention Agent
└── Sales Agent
```

### Key Patterns
- **Event bus:** Postgres outbox pattern (no Kafka/Redis at MVP scale)
- **Command bus:** Structured commands (`SendEmail`, `SendSMS`, `CreateTask`, `CloseTask`, `EscalateTask`, `EnrollInWorkflow`) — logged, retryable, auditable
- **Workflow engine:** TypeScript state machine configs stored in DB; natural language → AI converts to structured `WorkflowDefinition`
- **Multi-tenancy:** gym-scoped, `gym_id` indexed everywhere, portfolio-ready schema
- **Communications:** Unified `outbound_messages` table — email (Resend) + SMS (Twilio), delivery tracking + opt-outs

### Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Database:** Supabase (Postgres)
- **AI:** Anthropic Claude (Sonnet for reasoning, Haiku for drafting/rewriting)
- **Email:** Resend (outbound) + Resend inbound webhooks
- **SMS:** Twilio (planned)
- **Deployment:** Vercel
- **Tests:** Vitest (TDD on all agent classes)

---

## Key Features

### Demo Mode
- Gate form: name + email → visitor becomes first member card
- Real email sent to visitor's inbox via Resend
- Sandboxed — each session gets its own scoped data, auto-expires
- Gmail connect hidden in demo mode

### Agent Reply Loop
- Every outbound email has `Reply-To: reply+{actionId}@lunovoria.resend.app`
- Inbound webhook parses reply, strips quoted text, routes to reply agent
- Claude Sonnet evaluates: continue conversation / close / escalate
- Closes only on **concrete commitment** (specific day/class/time) or explicit no
- Escalates vague deflections back to human attention

### Playbook Builder
- Gym owners describe workflows in plain English
- AI generates structured `WorkflowDefinition` config
- Agents scan all active playbooks per run, apply whichever fit

### Humanizer Pipeline
- Every drafted message passes through a humanization step (Claude Haiku)
- Strips AI-sounding phrasing before anything ships
- Manual ✨ Rewrite available for further tweaks

### Gmail Integration
- OAuth connect per gym
- Sends via gym's own Gmail inbox (not a shared sending domain)
- Pub/Sub push for real-time reply routing

---

## Project Structure

```
app/
├── app/                    # Next.js App Router pages + API routes
│   ├── api/
│   │   ├── agents/         # Agent CRUD
│   │   ├── auth/gmail/     # Gmail OAuth flow
│   │   ├── autopilot/      # Agent run + approve actions
│   │   ├── connectors/     # Gmail, Instagram connectors
│   │   ├── demo/           # Demo mode endpoints
│   │   ├── reports/        # Monthly retention PDF
│   │   ├── rewrite-message/
│   │   ├── skills/         # Playbook CRUD
│   │   └── webhooks/       # Inbound email, Gmail Pub/Sub
│   └── dashboard/          # Main app UI
├── components/             # React components
├── lib/                    # Shared utilities
│   ├── gmail.ts            # Gmail send + OAuth helpers
│   ├── reply-agent.ts      # Inbound reply evaluation
│   └── supabase.ts         # DB client
├── migrations/             # Supabase SQL migrations
└── BRAND.md                # Design system reference
```

---

## Local Development

```bash
# Install dependencies
npm install

# Copy env (get values from Vercel dashboard or ask Dan)
cp .env.local.example .env.local

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Required Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `RESEND_API_KEY` | Resend email API key |
| `GOOGLE_CLIENT_ID` | GCP OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | GCP OAuth client secret |
| `GOOGLE_PUBSUB_TOPIC` | Pub/Sub topic for Gmail push |
| `DEMO_MODE` | `true` to enable demo gate |
| `DEMO_JWT_SECRET` | JWT secret for demo sessions |

---

## Testing

```bash
npm run test
```

Agent classes (`RetentionAgent`, `SalesAgent`, `GMAgent`) are written TDD — tests live alongside the code.

---

## Deployment

Deployed on Vercel. Push to `master` → auto-deploy.

Supabase project: `pmbqyetlgjnrpxpapfkf`
Live URL: `https://app-orcin-one-70.vercel.app`

---

## Roadmap

- [ ] SMS via Twilio
- [ ] Multi-playbook scan engine (agents evaluate all playbooks per run)
- [ ] `agent_tasks` / `task_conversations` data model (v2 schema)
- [ ] Sales Agent
- [ ] GM Agent chat interface
- [ ] Multi-location gym support
- [ ] Phone calls via Bland.ai / Vapi.ai
