-- 021: Unified conversations table
--
-- All communication channels (email, SMS, WhatsApp, Instagram, voice, chat)
-- funnel into a single conversations table. The Front Desk Agent thinks in
-- conversations, not channels. Channel is delivery metadata.
--
-- conversation_messages stores the chronological message thread, which may
-- span multiple channels over time.

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id      TEXT        NOT NULL,       -- member/lead ID from connector
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  channel         TEXT        NOT NULL,       -- primary channel: email, sms, whatsapp, instagram, facebook, voice, chat
  status          TEXT        NOT NULL DEFAULT 'open',  -- open, resolved, escalated, waiting_member, waiting_agent
  assigned_role   TEXT        NOT NULL DEFAULT 'front_desk',
  session_id      UUID,                       -- link to agent_sessions if actively handled
  subject         TEXT,                       -- email subject or conversation topic
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT        NOT NULL,       -- inbound, outbound
  channel         TEXT        NOT NULL,       -- which channel this specific message used
  content         TEXT        NOT NULL,
  sender          TEXT,                       -- contact name, agent role, staff name
  external_id     TEXT,                       -- provider message ID (Resend, Twilio, etc.)
  metadata        JSONB       NOT NULL DEFAULT '{}',  -- delivery status, read receipts, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_account     ON conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact     ON conversations(account_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status      ON conversations(account_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_role        ON conversations(account_id, assigned_role);
CREATE INDEX IF NOT EXISTS idx_conv_messages_conv        ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_messages_external    ON conversation_messages(external_id);
