-- Migration 009: Drop accounts.user_id
--
-- Prerequisites:
--   1. Migration 008 must have run (creates team_members table + backfills from accounts.user_id)
--   2. Code must be deployed that reads accounts via team_members (not accounts.user_id)
--   3. gym/connect no longer writes accounts.user_id
--
-- Run this in Supabase SQL editor AFTER the code changes are deployed and verified.

-- Step 1: Safety check — backfill any accounts that slipped through without a team_member row
INSERT INTO team_members (account_id, user_id, role)
SELECT a.id, a.user_id, 'owner'
FROM accounts a
WHERE a.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.account_id = a.id AND tm.user_id = a.user_id
  );

-- Step 2: Drop the column
ALTER TABLE accounts DROP COLUMN IF EXISTS user_id;
