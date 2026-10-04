CREATE TABLE IF NOT EXISTS captcha_access_grants (
 grant_id uuid PRIMARY KEY,
 handoff_id uuid NOT NULL REFERENCES captcha_handoffs,
 application_id uuid NOT NULL REFERENCES applications,
 candidate_profile_id text NOT NULL,
 browser_session_id uuid NOT NULL,
 token_salt text NOT NULL,
 token_hash text NOT NULL,
 cookie_hash text,
 csrf_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS captcha_access_active_idx ON captcha_access_grants(application_id,expires_at);
