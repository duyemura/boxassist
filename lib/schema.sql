-- GymAgents Platform Schema (v2 — event-driven)
-- Run this in Supabase SQL editor

-- Users table
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  stripe_customer_id text,
  stripe_subscription_status text,
  stripe_price_id text,
  trial_ends_at timestamptz,
  created_at timestamptz default now()
);

-- Gyms table
create table if not exists public.gyms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  pushpress_api_key text not null,
  pushpress_company_id text not null,
  account_name text not null default 'Your Gym',
  member_count integer not null default 0,
  webhook_id text,         -- PushPress webhook UUID (auto-registered on connect)
  connected_at timestamptz default now()
);

-- Agent runs table
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.gyms(id) on delete cascade not null,
  agent_type text not null,
  status text not null default 'running',
  input_summary text,
  output jsonb,
  action_taken text,
  created_at timestamptz default now()
);

-- Agent actions table
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid references public.agent_runs(id) on delete cascade,
  action_type text not null,
  content jsonb,
  approved boolean,
  dismissed boolean,
  created_at timestamptz default now()
);

-- Agents table (owner-configured agents with skill, trigger, and prompt)
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  skill_type text not null,
  name text,
  description text,
  goal text,                           -- owner's stated goal from setup wizard
  system_prompt text,
  trigger_config jsonb default '{}',
  trigger_mode text default 'cron',   -- 'cron' | 'event' | 'both' | 'manual'
  trigger_event text,                  -- e.g. 'lead.created', 'member.cancelled'
  cron_schedule text default 'weekly', -- 'hourly' | 'daily' | 'weekly'
  action_type text default 'draft_message', -- 'draft_message' | 'send_alert' | 'create_report'
  data_sources jsonb default '[]',     -- MCP tool names to call
  is_active boolean default true,
  last_run_at timestamptz,
  run_count integer default 0,
  approval_rate integer default 0,
  created_at timestamptz default now(),
  unique(account_id, skill_type)
);

-- Webhook events: raw events received from PushPress
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.gyms(id),
  event_type text not null,            -- 'lead.created', 'member.cancelled', etc.
  payload jsonb,
  processed_at timestamptz,
  agent_runs_triggered int default 0,
  created_at timestamptz default now()
);

-- Agent automations: when/how agents run (decoupled from agent capability)
create table if not exists public.agent_automations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  trigger_type text not null,          -- 'cron' | 'event'
  cron_schedule text,                  -- 'hourly' | 'daily' | 'weekly' (null for event)
  run_hour integer default 9,          -- 0-23 UTC (null for event/hourly)
  event_type text,                     -- e.g. 'lead.created' (null for cron)
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Legacy: agent_subscriptions (kept during migration, superseded by agent_automations)
create table if not exists public.agent_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  agent_id uuid references public.agents(id) on delete cascade not null,
  event_type text not null,            -- 'lead.created', 'member.cancelled', etc.
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(agent_id, event_type)
);

-- Enable RLS
alter table public.users enable row level security;
alter table public.gyms enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.agents enable row level security;
alter table public.webhook_events enable row level security;
alter table public.agent_subscriptions enable row level security;

-- Migration: add new columns to autopilots if table already exists
-- (safe to run multiple times)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='trigger_mode') then
    alter table public.autopilots add column trigger_mode text default 'cron';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='trigger_event') then
    alter table public.autopilots add column trigger_event text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='cron_schedule') then
    alter table public.autopilots add column cron_schedule text default 'weekly';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='name') then
    alter table public.autopilots add column name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='description') then
    alter table public.autopilots add column description text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='system_prompt') then
    alter table public.autopilots add column system_prompt text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='action_type') then
    alter table public.autopilots add column action_type text default 'draft_message';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='data_sources') then
    alter table public.autopilots add column data_sources jsonb default '[]';
  end if;
  -- agent_actions: make agent_run_id nullable (for MCP-logged actions)
  if exists (select 1 from information_schema.columns where table_name='agent_actions' and column_name='agent_run_id') then
    alter table public.agent_actions alter column agent_run_id drop not null;
  end if;
  -- estimated_value: human-readable value prop for the autopilot
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='estimated_value') then
    alter table public.autopilots add column estimated_value text;
  end if;
  -- Demo sandbox: scoped, expiring autopilot rows
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='demo_session_id') then
    alter table public.autopilots add column demo_session_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='expires_at') then
    alter table public.autopilots add column expires_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='autopilots' and column_name='user_id') then
    alter table public.autopilots add column user_id text;
  end if;
  -- Make account_id nullable so demo rows don't need a FK to gyms
  alter table public.autopilots alter column account_id drop not null;
end $$;

-- Service role has full access (used by backend)
-- No client-side policies needed since we use service role key in API routes

-- ============================================================
-- Gmail OAuth Integration (added for agent email feature)
-- ============================================================

-- Gmail OAuth tokens per gym
CREATE TABLE IF NOT EXISTS public.account_gmail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  gmail_address TEXT NOT NULL,
  access_token TEXT NOT NULL,   -- AES-256 encrypted
  refresh_token TEXT NOT NULL,  -- AES-256 encrypted
  token_expiry TIMESTAMPTZ,
  pubsub_history_id TEXT,       -- for Gmail push notifications (Pub/Sub)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id)
);

-- Email threads — track agent email conversations with members
CREATE TABLE IF NOT EXISTS public.agent_email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES public.agent_runs(id),
  member_id TEXT NOT NULL,
  member_email TEXT NOT NULL,
  gmail_thread_id TEXT,         -- Gmail's thread ID for grouping replies
  gmail_message_id TEXT,        -- The Message-ID header for reply threading
  subject TEXT,
  status TEXT DEFAULT 'active', -- active, resolved, escalated
  goal TEXT,                    -- what the agent is trying to achieve
  last_agent_message_at TIMESTAMPTZ,
  last_member_reply_at TIMESTAMPTZ,
  next_followup_at TIMESTAMPTZ,
  followup_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Individual messages in a thread
CREATE TABLE IF NOT EXISTS public.agent_email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.agent_email_threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,      -- 'outbound' (agent→member) or 'inbound' (member→agent)
  gmail_message_id TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  agent_reasoning TEXT          -- what the agent thought before sending
);

-- Enable RLS on new tables
ALTER TABLE public.account_gmail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_email_messages ENABLE ROW LEVEL SECURITY;
