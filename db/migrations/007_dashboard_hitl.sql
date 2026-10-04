CREATE TABLE IF NOT EXISTS application_answer_receipts (
 question_id uuid PRIMARY KEY REFERENCES application_questions,
 application_id uuid NOT NULL REFERENCES applications,
 source text NOT NULL CHECK(source IN ('USER_DASHBOARD','USER_TELEGRAM')),
 dispatch_status text NOT NULL DEFAULT 'PENDING' CHECK(dispatch_status IN ('PENDING','RUNNING','COMPLETED','MANUAL_RECONCILIATION')),
 created_at timestamptz NOT NULL DEFAULT now(), dispatch_started_at timestamptz,
 dispatch_completed_at timestamptz, dispatch_error_code text
);
CREATE INDEX IF NOT EXISTS application_answer_dispatch_idx ON application_answer_receipts(dispatch_status,created_at);
CREATE TABLE IF NOT EXISTS application_review_gates (
 approval_id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications,
 candidate_profile_id text NOT NULL, campaign_id text NOT NULL DEFAULT 'MANUAL_REVIEW_V1',
 status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN ('PREPARED','APPROVED','CONSUMED','REVOKED','EXPIRED')),
 digests jsonb NOT NULL, binding_digest text NOT NULL CHECK(binding_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 approved_at timestamptz, consumed_at timestamptz, revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS application_review_gates_app_idx ON application_review_gates(application_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS application_review_active_idx ON application_review_gates(application_id)
 WHERE status IN ('PREPARED','APPROVED');
