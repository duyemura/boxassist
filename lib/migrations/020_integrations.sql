-- Migration 020: Integrations (Composio-backed)
-- Maps our accounts to Composio entities and caches connection status for the UI.
-- Source of truth for credentials/tokens is Composio — these tables are thin wrappers.

-- Stores one row per connected integration per account
-- connected_account_id is the Composio ID we get back after a successful connection
CREATE TABLE IF NOT EXISTS account_integrations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  integration_id        TEXT        NOT NULL,               -- 'slack', 'gmail', 'twilio'
  composio_account_id   TEXT,                               -- Composio connectedAccountId (set after callback)
  composio_auth_config  TEXT,                               -- Composio authConfigId used
  connected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata              JSONB       NOT NULL DEFAULT '{}',  -- { workspace: 'PushPress', email: '...', from_number: '...' }
  UNIQUE (account_id, integration_id)
);

CREATE INDEX IF NOT EXISTS account_integrations_account_id ON account_integrations (account_id);

ALTER TABLE account_integrations ENABLE ROW LEVEL SECURITY;
