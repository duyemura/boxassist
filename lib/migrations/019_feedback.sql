-- 019_feedback.sql
-- Real-time feedback pipeline: captures user feedback, bug reports, errors, and suggestions.

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text,
  user_id text,
  type text NOT NULL DEFAULT 'feedback' CHECK (type IN ('feedback', 'bug', 'error', 'suggestion')),
  message text NOT NULL,
  url text,
  metadata jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'fixed', 'wontfix')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_account ON feedback(account_id, created_at DESC);
