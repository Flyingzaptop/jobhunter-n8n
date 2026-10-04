CREATE TABLE IF NOT EXISTS application_prose_drafts (
 draft_id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications,
 binding_hash text NOT NULL UNIQUE, job_id uuid NOT NULL REFERENCES jobs,
 profile_hash text NOT NULL, job_hash text NOT NULL, policy_hash text NOT NULL,
 form_fingerprint text NOT NULL, field_selector text NOT NULL, field_label text NOT NULL,
 field_type text NOT NULL, input_json jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','GENERATING','READY','CONSUMED','REJECTED','RETRY')),
 text_answer text, provenance text NOT NULL DEFAULT 'MODEL_GROUNDED' CHECK(provenance='MODEL_GROUNDED'),
 model text, claims_json jsonb, qa_json jsonb,
 attempt_count integer NOT NULL DEFAULT 0, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS application_prose_queue_idx ON application_prose_drafts(status,created_at);
