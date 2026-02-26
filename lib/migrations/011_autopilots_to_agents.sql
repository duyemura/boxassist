-- Migration 011: autopilots → agents
--
-- Changes:
--   1. Rename autopilots → agents (agent-builder reframe: owners build their own)
--   2. Rename autopilot_id → agent_id on agent_subscriptions (FK column)
--   3. Add goal column (owner's stated goal from the setup wizard — free text)
--   4. Rename RLS policy
--
-- Existing columns are preserved as-is:
--   skill_type, name, description, system_prompt, trigger_mode, trigger_event,
--   cron_schedule, action_type, data_sources, estimated_value, is_active,
--   run_count, demo_session_id, expires_at, user_id, account_id
--
-- Run in Supabase SQL Editor.

-- ── 1. Rename table ───────────────────────────────────────────────────────────

ALTER TABLE public.autopilots RENAME TO agents;

-- ── 2. Rename FK column on agent_subscriptions ───────────────────────────────

ALTER TABLE public.agent_subscriptions
  RENAME COLUMN autopilot_id TO agent_id;

-- ── 3. Add goal column ───────────────────────────────────────────────────────
-- Free-text owner description of what this agent should do.
-- Written during wizard Step 1; used to generate system_prompt variations.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS goal text;

-- ── 4. Rename indexes (cosmetic — avoids confusion in Supabase UI) ────────────

ALTER INDEX IF EXISTS autopilots_pkey RENAME TO agents_pkey;

-- ── 5. Rename RLS policy ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS autopilots_gym_scope ON agents;

-- Recreate for the renamed table
CREATE POLICY agents_account_scope ON agents
  FOR ALL
  USING (
    -- Scoped rows: user must be a team member of the account
    (account_id IS NOT NULL AND account_id IN (
      SELECT account_id FROM team_members WHERE user_id = auth.uid()
    ))
    -- Demo rows: scoped by session (no account FK)
    OR demo_session_id IS NOT NULL
    -- Rows with explicit user_id (legacy demo)
    OR user_id = auth.uid()::text
  );

DO $$ BEGIN
  RAISE NOTICE 'Migration 011 complete: autopilots → agents.';
END $$;
