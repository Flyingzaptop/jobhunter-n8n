CREATE TABLE IF NOT EXISTS jobs_raw (
 raw_id uuid PRIMARY KEY, source_name text NOT NULL, source_item_id text, source_url text NOT NULL,
 payload_json jsonb NOT NULL, discovered_at timestamptz NOT NULL DEFAULT now(), ingestion_run_id uuid,
 UNIQUE(source_name, source_item_id, source_url)
);
CREATE TABLE IF NOT EXISTS jobs (
 job_id uuid PRIMARY KEY, canonical_url text NOT NULL UNIQUE, application_url text, company text NOT NULL,
 title text NOT NULL, location text, country text, work_mode text, description_text text NOT NULL,
 content_hash text, availability_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(availability_status IN ('OPEN','CLOSED','UNKNOWN')),
 status text NOT NULL DEFAULT 'NEW', first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 last_verified_open_at timestamptz, closed_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS job_sources (
 job_id uuid NOT NULL REFERENCES jobs, source_name text NOT NULL, source_url text NOT NULL, source_item_id text,
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,source_name,source_url)
);
CREATE TABLE IF NOT EXISTS job_analysis (
 analysis_id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs, model text NOT NULL,
 prompt_version text NOT NULL, profile_version text NOT NULL, overall_fit numeric, application_priority numeric,
 decision text NOT NULL CHECK(decision IN ('REJECT','STRETCH','REVIEW','AUTO_APPLY')), analysis_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cv_versions (
 cv_id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs, profile_version text NOT NULL,
 template_version text NOT NULL, model text NOT NULL, pdf_path text NOT NULL, html_path text NOT NULL,
 sha256 text NOT NULL, qa_json jsonb NOT NULL, manifest_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS applications (
 application_id uuid PRIMARY KEY, candidate_profile_id text NOT NULL, job_id uuid NOT NULL REFERENCES jobs,
 cv_id uuid REFERENCES cv_versions,
 status text NOT NULL CHECK(status IN ('QUEUED','OPENING','FILLING','NEEDS_USER','CAPTCHA_WAIT','MANUAL_TAKEOVER','READY_TO_SUBMIT','SUBMITTING','SUBMITTED','SUBMISSION_UNKNOWN','FAILED','SKIPPED','ALREADY_APPLIED')),
 dry_run boolean NOT NULL DEFAULT true, submit_blocked_reason text, skip_reason text,
 started_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz, confirmation_text text, confirmation_id text,
 failure_reason text, last_state jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_profile_id,job_id)
);
CREATE TABLE IF NOT EXISTS application_questions (
 question_id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications, normalized_question text NOT NULL,
 raw_question text NOT NULL, answer jsonb, answer_source text, confidence numeric, reusable boolean NOT NULL DEFAULT false,
 telegram_request_id uuid NOT NULL UNIQUE, telegram_message_id bigint, created_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz
);
CREATE TABLE IF NOT EXISTS application_outcomes (
 outcome_id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications, outcome_status text NOT NULL CHECK(outcome_status IN ('NO_RESPONSE','RECRUITER_REPLY','HR_SCREEN','TECHNICAL_INTERVIEW','INTERVIEW_OTHER','OFFER','REJECTED','WITHDRAWN','CLOSED_BY_EMPLOYER','UNKNOWN')),
 source text NOT NULL, notes text, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS consents (
 consent_id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES applications, consent_text text NOT NULL,
 consent_text_hash text NOT NULL, consent_type text NOT NULL, source text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
 event_id uuid PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL, event_type text NOT NULL,
 payload_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION prevent_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS immutable_events ON events;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();
CREATE TABLE IF NOT EXISTS runtime_control (id boolean PRIMARY KEY DEFAULT true CHECK(id), paused boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO runtime_control(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
CREATE INDEX IF NOT EXISTS analysis_job_idx ON job_analysis(job_id,created_at DESC);
