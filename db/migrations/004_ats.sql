CREATE TABLE IF NOT EXISTS ats_compatibility_runs (
  benchmark_id uuid PRIMARY KEY,
  adapter text NOT NULL,
  job_id uuid REFERENCES jobs(job_id),
  browser_session_id uuid,
  status text NOT NULL,
  report_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
