CREATE TABLE IF NOT EXISTS relevance_queue (
 job_id uuid PRIMARY KEY REFERENCES jobs(job_id), relevance_version text NOT NULL,
 input_hash text NOT NULL, relevance_score integer NOT NULL CHECK(relevance_score BETWEEN 0 AND 100),
 status text NOT NULL CHECK(status IN('QUEUED','LOW_PRIORITY','CLOSED','RUNNING','ANALYZED','RETRY','DEAD_LETTER','OPEN_UNVERIFIED')),
 role_hints jsonb NOT NULL DEFAULT '[]', reasons jsonb NOT NULL DEFAULT '[]',
 location_class text NOT NULL, seniority_class text NOT NULL, needs_hydration boolean NOT NULL DEFAULT false,
 last_completed_hash text, active_fit_hash text, attempt_count integer NOT NULL DEFAULT 0,
 next_retry_at timestamptz, error_code text, claimed_by uuid, claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relevance_queue_ready_idx ON relevance_queue(status,relevance_score DESC,next_retry_at);
CREATE TABLE IF NOT EXISTS fit_batch_receipts (
 job_id uuid NOT NULL REFERENCES jobs(job_id), fit_input_hash text NOT NULL,
 analysis_id uuid NOT NULL REFERENCES job_analysis(analysis_id), run_id uuid NOT NULL,
 model text NOT NULL, profile_hash text NOT NULL, policy_hash text NOT NULL, prompt_version text NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,fit_input_hash)
);
CREATE TABLE IF NOT EXISTS fit_calibration_labels (
 label_id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(job_id), source_quote text NOT NULL,
 quote_hash text NOT NULL, source_url text NOT NULL, label_json jsonb NOT NULL,
 author_type text NOT NULL CHECK(author_type IN('ASSISTANT_AGENT','HUMAN_USER')),
 review_status text NOT NULL CHECK(review_status IN('PENDING_AGENT_REVIEW','AGENT_REVIEWED_USER_PENDING','USER_REVIEWED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,quote_hash,author_type)
);
