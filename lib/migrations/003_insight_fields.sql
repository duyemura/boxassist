-- ============================================================
-- Phase 3: GM Agent — Insight Fields Migration
-- 003_insight_fields.sql
--
-- SAFE TO RUN ON LIVE DATABASE: all additive, uses IF NOT EXISTS.
-- Adds insight-specific columns to agent_tasks.
-- Creates gym_kpi_snapshots table for KPI trend tracking.
-- ============================================================

-- ============================================================
-- 1. Add insight-specific fields to agent_tasks
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='insight_type') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN insight_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='insight_title') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN insight_title TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='insight_detail') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN insight_detail TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='recommended_action') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN recommended_action TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='estimated_impact') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN estimated_impact TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='draft_message') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN draft_message TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_tasks' AND column_name='priority') THEN
    ALTER TABLE public.agent_tasks ADD COLUMN priority TEXT DEFAULT 'medium';
  END IF;
END $$;

-- ============================================================
-- 2. gym_kpi_snapshots — periodic KPI trend tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gym_kpi_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID        NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_members    INT,
  churn_risk_count  INT,
  avg_visits_per_week FLOAT,
  revenue_mtd       FLOAT,
  open_tasks        INT,
  insights_generated INT,
  raw_data          JSONB       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_gym
  ON public.gym_kpi_snapshots(gym_id, captured_at DESC);
