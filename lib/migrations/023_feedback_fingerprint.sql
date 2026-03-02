-- 023: Add error_fingerprint column to feedback table for dedup
-- Same error firing repeatedly creates piles of identical tickets.
-- Fingerprint lets us detect duplicates server-side and comment instead of creating new tickets.

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS error_fingerprint TEXT;

-- Partial index: only fingerprinted rows, ordered by recency.
-- Used to find the most recent feedback row with the same fingerprint.
CREATE INDEX IF NOT EXISTS idx_feedback_fingerprint_recent
  ON feedback (error_fingerprint, created_at DESC)
  WHERE error_fingerprint IS NOT NULL;
