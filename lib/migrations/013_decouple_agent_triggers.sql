-- Migration 013: Decouple agent triggers from agent capabilities
--
-- Agents become pure capabilities (what the agent IS).
-- Automations define when/how agents run (cron, event, manual).
-- Agent runs track each execution with trigger source.
--
-- Backward-compatible: old columns stay on agents until cleanup migration.

-- ── 1. Create agent_automations table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,        -- 'cron' | 'event'
  cron_schedule text,                -- 'hourly' | 'daily' | 'weekly' (null for event)
  run_hour integer DEFAULT 9,        -- 0-23 UTC (null for event/hourly)
  event_type text,                   -- e.g. 'lead.created' (null for cron)
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_automations ENABLE ROW LEVEL SECURITY;

-- ── 2. Enrich agent_runs with agent linkage + trigger source ────────────────

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_id uuid REFERENCES public.agent_automations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trigger_source text DEFAULT 'manual',  -- 'cron' | 'event' | 'manual'
  ADD COLUMN IF NOT EXISTS trigger_ref text;                       -- event type or schedule label

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON public.agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_trigger ON public.agent_runs(trigger_source);

-- ── 3. Migrate existing data ─────────────────────────────────────────────────

-- Cron automations (from agents with trigger_mode = 'cron' or 'both')
INSERT INTO public.agent_automations (agent_id, account_id, trigger_type, cron_schedule, run_hour, is_active)
SELECT
  a.id, a.account_id, 'cron',
  COALESCE(a.cron_schedule, 'daily'),
  COALESCE(a.run_hour, 9),
  a.is_active
FROM public.agents a
WHERE a.trigger_mode IN ('cron', 'both')
  AND a.account_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Event automations (from agents with trigger_mode = 'event' or 'both')
INSERT INTO public.agent_automations (agent_id, account_id, trigger_type, event_type, is_active)
SELECT
  a.id, a.account_id, 'event', a.trigger_event, a.is_active
FROM public.agents a
WHERE a.trigger_mode IN ('event', 'both')
  AND a.trigger_event IS NOT NULL
  AND a.account_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Migrate agent_subscriptions that aren't already covered
INSERT INTO public.agent_automations (agent_id, account_id, trigger_type, event_type, is_active)
SELECT
  s.agent_id, s.account_id, 'event', s.event_type, s.is_active
FROM public.agent_subscriptions s
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_automations aa
  WHERE aa.agent_id = s.agent_id AND aa.trigger_type = 'event' AND aa.event_type = s.event_type
)
ON CONFLICT DO NOTHING;
