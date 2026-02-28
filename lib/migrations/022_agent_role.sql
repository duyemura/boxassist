-- 022: Add role column to agents table
--
-- Agents can now have a role identity (e.g., 'front-desk', 'gm').
-- The role loads a natural language job description from lib/roles/<role>.md
-- as Layer 0 of the prompt stack — identity before skills and memories.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT;

-- Index for querying agents by role
CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(account_id, role);
