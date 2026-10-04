CREATE TABLE IF NOT EXISTS confirmed_submit_commands (
 command_id uuid PRIMARY KEY, application_id uuid NOT NULL UNIQUE REFERENCES applications,
 approval_id uuid NOT NULL REFERENCES application_review_gates, idempotency_key uuid NOT NULL UNIQUE,
 binding_digest text NOT NULL, status text NOT NULL CHECK(status IN ('PREPARING','SUBMITTING','SUBMITTED','SUBMISSION_UNKNOWN','BLOCKED')),
 result_json jsonb, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
