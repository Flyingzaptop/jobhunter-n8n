ALTER TABLE captcha_handoffs ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE captcha_handoffs ADD COLUMN IF NOT EXISTS resolution_source text;
ALTER TABLE captcha_handoffs ADD COLUMN IF NOT EXISTS resolved_snapshot_fingerprint text;
ALTER TABLE captcha_handoffs ADD COLUMN IF NOT EXISTS resolved_browser_session_id uuid;
