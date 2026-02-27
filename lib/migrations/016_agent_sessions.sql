-- ── agent_sessions ───────────────────────────────────────────────────────────
-- Persistent conversation sessions for the goal-driven agent runtime.
-- Each session is a multi-turn Claude conversation with tool use.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL,
  agent_id          uuid REFERENCES agents(id),      -- null for ad-hoc sessions
  goal              text NOT NULL,
  status            text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'waiting_input', 'waiting_approval', 'waiting_event', 'completed', 'failed')),
  autonomy_mode     text NOT NULL DEFAULT 'semi_auto'
    CHECK (autonomy_mode IN ('full_auto', 'semi_auto', 'turn_based')),
  messages          jsonb NOT NULL DEFAULT '[]',      -- Claude messages array
  system_prompt     text DEFAULT '',                  -- assembled system prompt for this session
  pending_approvals jsonb DEFAULT '[]',               -- PendingToolCall[]
  tools_enabled     text[] DEFAULT '{data,learning}',
  turn_count        int NOT NULL DEFAULT 0,
  max_turns         int NOT NULL DEFAULT 20,
  model             text NOT NULL DEFAULT 'claude-sonnet-4-6',
  context           jsonb DEFAULT '{}',               -- working set, credentials, etc.
  outputs           jsonb DEFAULT '[]',               -- structured outputs (tasks, emails, memories)
  cost_cents        int DEFAULT 0,                    -- accumulated AI cost
  budget_cents      int DEFAULT 100,                  -- max cost before auto-pause ($1 default)
  expires_at        timestamptz,                      -- auto-close dormant sessions
  created_by        text DEFAULT 'owner'
    CHECK (created_by IN ('owner', 'cron', 'event', 'system')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Active sessions for an account (most common query)
CREATE INDEX IF NOT EXISTS idx_agent_sessions_account_status
  ON agent_sessions(account_id, status);

-- Find active/waiting sessions quickly
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active
  ON agent_sessions(account_id)
  WHERE status IN ('active', 'waiting_input', 'waiting_approval', 'waiting_event');

-- Session monitor cron: find waiting_event sessions for nudge checks
CREATE INDEX IF NOT EXISTS idx_agent_sessions_waiting_event
  ON agent_sessions(status, updated_at)
  WHERE status = 'waiting_event';

-- RLS
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_sessions_account_access ON agent_sessions
  FOR ALL
  USING (
    account_id IN (
      SELECT tm.account_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- Add session_id column to outbound_messages for linking emails to sessions
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES agent_sessions(id);
