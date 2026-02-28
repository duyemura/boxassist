-- Migration 015: Data Lens Memories
--
-- Extends the memories table with columns for connector-backed, refreshable
-- "data lens" memories. A data lens is a named summary of connector data
-- that persists between agent runs, refreshes on a schedule, and gets
-- injected into agent context like any other memory.
--
-- Regular memories (owner-created, agent-learned) have data_lens = NULL.
-- Data lens memories are auto-managed by the harvest step after each data fetch.
--
-- Run in Supabase SQL Editor.

-- The lens name: 'ghost_leads', 'ex_members', 'active_at_risk', etc.
-- NULL for regular memories. Unique per account when set.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS data_lens text;

-- Where this data came from, so we know how to refresh it.
-- e.g. { "connector": "pushpress", "segment": "prospects", "filter": "age>30d" }
ALTER TABLE memories ADD COLUMN IF NOT EXISTS data_source jsonb;

-- Structured backing data (counts, IDs, computed fields).
-- The memory `content` is the human-readable summary; this is the machine-readable data.
-- e.g. { "count": 42, "high_priority": 15, "ids": ["id1", "id2"], "computed_at": "..." }
ALTER TABLE memories ADD COLUMN IF NOT EXISTS data_snapshot jsonb;

-- When this lens was last refreshed from its connector source.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS refreshed_at timestamptz;

-- How long before this lens is considered stale. NULL = never stales (static memory).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS stale_after interval;

-- Unique constraint: one lens per account per name.
-- Regular memories (data_lens IS NULL) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_data_lens_unique
  ON memories (account_id, data_lens)
  WHERE data_lens IS NOT NULL AND active = true;

-- Index for finding stale lenses that need refresh
CREATE INDEX IF NOT EXISTS idx_memories_stale_lens
  ON memories (refreshed_at, stale_after)
  WHERE data_lens IS NOT NULL AND active = true;
