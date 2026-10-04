ALTER TABLE application_prose_drafts ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
CREATE INDEX IF NOT EXISTS application_prose_retry_due_idx
 ON application_prose_drafts(status,next_retry_at,created_at);
