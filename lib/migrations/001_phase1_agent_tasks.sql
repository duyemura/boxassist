-- ============================================================
-- Phase 1: GymAgents Architecture Migration
-- 001_phase1_agent_tasks.sql
--
-- SAFE TO RUN ON LIVE DATABASE: all additive, no drops, no
-- destructive alters. Uses IF NOT EXISTS everywhere.
-- ============================================================

-- ============================================================
-- 1. agent_events — outbox / event log
--    gym_id is NOT a FK to gyms so we can safely use the demo
--    UUID (00000000-0000-0000-0000-000000000001) without a real row.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID        NOT NULL,
  event_type    TEXT        NOT NULL,
  aggregate_id  TEXT        NOT NULL,
  aggregate_type TEXT       NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',
  metadata      JSONB       NOT NULL DEFAULT '{}',
  published     BOOLEAN     NOT NULL DEFAULT FALSE,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_unpublished
  ON public.agent_events(created_at)
  WHERE published = FALSE;

CREATE INDEX IF NOT EXISTS idx_agent_events_gym_type
  ON public.agent_events(gym_id, event_type, created_at DESC);

-- ============================================================
-- 2. agent_tasks — richer task model replacing agent_actions
--    gym_id is NOT a strict FK — allows demo UUID.
--    legacy_action_id links back to agent_actions for migration.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id              UUID        NOT NULL,
  assigned_agent      TEXT        NOT NULL,          -- 'retention', 'sales', 'gm'
  created_by_agent    TEXT        NOT NULL DEFAULT 'gm',
  task_type           TEXT        NOT NULL,          -- 'attendance_drop_intervention', 'no_show_recovery', 'lead_followup', 'churn_prevention', 'manual'
  member_id           TEXT,
  lead_id             TEXT,
  member_email        TEXT,
  member_name         TEXT,
  goal                TEXT        NOT NULL,
  context             JSONB       NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'open', -- 'open','awaiting_reply','awaiting_approval','in_progress','resolved','escalated','cancelled'
  next_action_at      TIMESTAMPTZ,
  requires_approval   BOOLEAN     NOT NULL DEFAULT FALSE,
  approved_at         TIMESTAMPTZ,
  approved_by         UUID,
  outcome             TEXT,                          -- 'converted','recovered','engaged','unresponsive','churned','escalated','not_applicable'
  outcome_score       FLOAT,
  outcome_reason      TEXT,
  resolved_at         TIMESTAMPTZ,
  causation_event_id  UUID,
  legacy_action_id    UUID        REFERENCES public.agent_actions(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_gym_status
  ON public.agent_tasks(gym_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent
  ON public.agent_tasks(assigned_agent, status);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_member
  ON public.agent_tasks(member_email, gym_id);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_next_action
  ON public.agent_tasks(next_action_at)
  WHERE next_action_at IS NOT NULL
    AND status IN ('open', 'awaiting_reply', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_agent_tasks_legacy_action
  ON public.agent_tasks(legacy_action_id)
  WHERE legacy_action_id IS NOT NULL;

-- ============================================================
-- 3. task_conversations — replaces agent_conversations
--    gym_id is UUID here (use DEMO_GYM_ID for demo rows).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.task_conversations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  gym_id      UUID        NOT NULL,
  role        TEXT        NOT NULL,   -- 'agent', 'member', 'system'
  content     TEXT        NOT NULL,
  agent_name  TEXT,
  evaluation  JSONB,                  -- {reasoning, action, outcomeScore, resolved, scoreReason}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_conversations_task
  ON public.task_conversations(task_id, created_at ASC);

-- ============================================================
-- 4. outbound_messages — unified email + SMS send tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id              UUID        NOT NULL,
  task_id             UUID        REFERENCES public.agent_tasks(id),
  sent_by_agent       TEXT        NOT NULL,
  channel             TEXT        NOT NULL,          -- 'email', 'sms'
  recipient_email     TEXT,
  recipient_phone     TEXT,
  recipient_name      TEXT,
  subject             TEXT,
  body                TEXT        NOT NULL,
  reply_token         TEXT,
  status              TEXT        NOT NULL DEFAULT 'queued', -- 'queued','sent','delivered','bounced','failed','opted_out'
  provider            TEXT,                          -- 'resend', 'twilio'
  provider_message_id TEXT,
  delivered_at        TIMESTAMPTZ,
  failed_reason       TEXT,
  replied_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_messages_task
  ON public.outbound_messages(task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_token
  ON public.outbound_messages(reply_token)
  WHERE reply_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outbound_messages_gym
  ON public.outbound_messages(gym_id, channel, created_at DESC);

-- ============================================================
-- 5. communication_optouts — prevent messaging opted-out contacts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.communication_optouts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID        NOT NULL,
  channel     TEXT        NOT NULL,
  contact     TEXT        NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason      TEXT,
  UNIQUE(gym_id, channel, contact)
);

CREATE INDEX IF NOT EXISTS idx_communication_optouts_lookup
  ON public.communication_optouts(gym_id, channel, contact);

-- ============================================================
-- 6. Demo gym row — PushPress East
--
--    Fixed UUID: 00000000-0000-0000-0000-000000000001
--    This is referenced as DEMO_GYM_ID throughout the codebase.
--
--    PROBLEM: gyms.user_id is NOT NULL with a FK to users.
--    SOLUTION: Use a DO block to only insert if at least one user
--    exists. If no users exist yet, skip gracefully. The INSERT
--    uses ON CONFLICT (id) DO NOTHING so it's safe to re-run.
-- ============================================================
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Pick the first user — or bail out if none exist yet
  SELECT id INTO v_user_id FROM public.users LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No users found — skipping demo gym insert. Run this migration again after creating a user.';
  ELSE
    INSERT INTO public.gyms (
      id,
      user_id,
      pushpress_api_key,
      pushpress_company_id,
      gym_name,
      member_count
    )
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      v_user_id,
      'demo_api_key',
      'pushpress_east',
      'PushPress East',
      150
    )
    ON CONFLICT (id) DO NOTHING;

    IF FOUND THEN
      RAISE NOTICE 'Demo gym (PushPress East) inserted with user_id=%', v_user_id;
    ELSE
      RAISE NOTICE 'Demo gym already exists — skipped.';
    END IF;
  END IF;
END $$;
