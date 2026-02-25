-- ============================================================
-- Migration 002: Retention Machine
--
-- Adds columns needed for:
-- - Real membership pricing (avg_membership_price on gyms)
-- - Autopilot mode (autopilot_enabled, autopilot_enabled_at on gyms)
-- - Outcome attribution (attributed_value, attributed_at on agent_tasks)
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1. Gyms table: avg membership price + autopilot mode
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS avg_membership_price NUMERIC DEFAULT 150,
  ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopilot_enabled_at TIMESTAMPTZ;

-- 2. Agent tasks: attribution fields
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS attributed_value NUMERIC,
  ADD COLUMN IF NOT EXISTS attributed_at TIMESTAMPTZ;

-- 3. Index for attribution cron (tasks needing outcome check)
CREATE INDEX IF NOT EXISTS idx_agent_tasks_attribution
  ON agent_tasks (status, outcome, member_email, created_at)
  WHERE outcome IS NULL AND member_email IS NOT NULL;

-- 4. Index for autopilot processing (tasks not requiring approval)
CREATE INDEX IF NOT EXISTS idx_agent_tasks_autopilot
  ON agent_tasks (requires_approval, status)
  WHERE requires_approval = false AND status = 'open';

-- 5. Index for win-back follow-ups
CREATE INDEX IF NOT EXISTS idx_agent_tasks_followup
  ON agent_tasks (status, task_type, next_action_at)
  WHERE status = 'awaiting_reply' AND next_action_at IS NOT NULL;
