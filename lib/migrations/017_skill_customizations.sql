-- Migration 017: Per-account skill customizations
-- Lets owners add their own instructions to any skill, injected between
-- the skill body and business memories in the prompt (Layer 2b).

CREATE TABLE IF NOT EXISTS skill_customizations (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id  UUID        NOT NULL,
  skill_id    TEXT        NOT NULL,
  notes       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, skill_id)
);

CREATE INDEX IF NOT EXISTS skill_customizations_account_idx
  ON skill_customizations (account_id);
