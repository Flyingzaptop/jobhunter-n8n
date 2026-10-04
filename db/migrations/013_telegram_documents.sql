CREATE TABLE IF NOT EXISTS telegram_document_delivery_state (
 profile_hash text PRIMARY KEY CHECK(profile_hash ~ '^[a-f0-9]{64}$'),
 candidate_profile_id text NOT NULL,
 cv_created_after timestamptz NOT NULL,
 initialized_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS telegram_document_deliveries (
 delivery_id uuid PRIMARY KEY,
 cv_id uuid NOT NULL REFERENCES cv_versions(cv_id),
 job_id uuid NOT NULL REFERENCES jobs(job_id),
 candidate_profile_id text NOT NULL,
 profile_hash text NOT NULL CHECK(profile_hash ~ '^[a-f0-9]{64}$'),
 pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN('QUEUED','WAITING_CONFIGURATION','CLAIMED','SENDING','SENT','RETRY','STALE','BLOCKED','FAILED','DELIVERY_UNKNOWN')),
 claim_token uuid,claim_until timestamptz,
 attempt_count integer NOT NULL DEFAULT 0,
 telegram_chat_id text,telegram_message_id bigint,
 error_code text,next_attempt_at timestamptz,
 sending_at timestamptz,delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cv_id,pdf_sha256),
 CHECK(status<>'SENT' OR (telegram_message_id IS NOT NULL AND telegram_message_id>0 AND delivered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS telegram_document_pending ON telegram_document_deliveries(profile_hash,created_at)
 WHERE status IN('QUEUED','WAITING_CONFIGURATION','RETRY','CLAIMED','SENDING');
