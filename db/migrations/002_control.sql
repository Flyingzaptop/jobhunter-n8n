CREATE TABLE IF NOT EXISTS operation_runs (
 run_id uuid PRIMARY KEY, stage smallint NOT NULL CHECK(stage BETWEEN 1 AND 6),
 trigger text NOT NULL, mode text NOT NULL DEFAULT 'REAL' CHECK(mode IN ('REAL','MOCK')),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','WAITING','NEEDS_USER','BLOCKED','PAUSED','SUCCEEDED','FAILED','CANCELLED')),
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, heartbeat_at timestamptz NOT NULL DEFAULT now(),
 processed_count integer NOT NULL DEFAULT 0, success_count integer NOT NULL DEFAULT 0, failure_count integer NOT NULL DEFAULT 0,
 total_count integer, current_entity jsonb, message text NOT NULL DEFAULT '', metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS operation_runs_stage_idx ON operation_runs(stage,started_at DESC);
CREATE INDEX IF NOT EXISTS events_run_idx ON events((payload_json->>'run_id'),created_at);
CREATE TABLE IF NOT EXISTS admin_sessions (
 session_hash text PRIMARY KEY, csrf_hash text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dashboard_operations (
 operation_id uuid PRIMARY KEY, stage smallint NOT NULL CHECK(stage BETWEEN 1 AND 6),
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','BLOCKED')),
 requested_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
 result jsonb, error_code text
);
CREATE TABLE IF NOT EXISTS cv_drafts (
 cv_id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs, status text NOT NULL,
 manifest_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS analysis_attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_analysis_error text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_analysis_retry_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS analysis_failure_kind text;
CREATE TABLE IF NOT EXISTS telegram_update_cursor (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), next_update_id bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO telegram_update_cursor(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS telegram_processed_updates (
 update_id bigint PRIMARY KEY, outcome text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now()
);
