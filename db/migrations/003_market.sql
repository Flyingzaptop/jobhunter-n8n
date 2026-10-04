-- Discovery v2: observed source health, not claimed catalog coverage.
CREATE TABLE IF NOT EXISTS market_discovery_runs (
 run_id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 status text NOT NULL DEFAULT 'RUNNING', report_json jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS market_source_runs (
 source_run_id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES market_discovery_runs(run_id),
 source_id text NOT NULL, platform text NOT NULL, adapter text NOT NULL, status text NOT NULL,
 started_at timestamptz NOT NULL, completed_at timestamptz, latency_ms integer,
 raw_count integer NOT NULL DEFAULT 0, unique_count integer NOT NULL DEFAULT 0,
 new_count integer NOT NULL DEFAULT 0, duplicate_count integer NOT NULL DEFAULT 0,
 error_code text, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS market_source_runs_source_time ON market_source_runs(source_id,started_at DESC);
CREATE TABLE IF NOT EXISTS market_source_health (
 source_id text PRIMARY KEY, platform text NOT NULL, adapter text NOT NULL, status text NOT NULL,
 last_run_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
 total_runs integer NOT NULL DEFAULT 0, total_failures integer NOT NULL DEFAULT 0,
 jobs_returned integer NOT NULL DEFAULT 0, unique_jobs integer NOT NULL DEFAULT 0,
 relevant_jobs integer, latency_ms integer, error_code text, metadata jsonb NOT NULL DEFAULT '{}'
);
COMMENT ON COLUMN market_source_health.relevant_jobs IS 'NULL until actual fit analysis, never keyword relevance represented as candidate fit';
