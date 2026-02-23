-- Migration 002: agent_commands table
-- Run in Supabase SQL editor after deploying Phase 2.

CREATE TABLE IF NOT EXISTS public.agent_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id          UUID NOT NULL,
  command_type    TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  issued_by_agent TEXT NOT NULL,
  task_id         UUID,
  causation_event_id UUID,
  correlation_id  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commands_pending
  ON public.agent_commands(next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_commands_task
  ON public.agent_commands(task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commands_gym
  ON public.agent_commands(gym_id, command_type, created_at DESC);
