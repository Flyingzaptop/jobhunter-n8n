CREATE TABLE IF NOT EXISTS continuous_work (
 work_key text PRIMARY KEY, lane text NOT NULL, entity_id uuid,
 status text NOT NULL CHECK(status IN ('RUNNING','COMPLETED','DRAFT_PENDING_VISUAL','WAITING_USER','RETRY')),
 owner_id uuid, lease_until timestamptz, attempt_count integer NOT NULL DEFAULT 1,
 next_retry_at timestamptz, outcome_code text, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS continuous_work_claim_idx ON continuous_work(lane,status,next_retry_at,lease_until);
CREATE TABLE IF NOT EXISTS continuous_worker_status (
 lane text PRIMARY KEY, owner_id uuid NOT NULL, state text NOT NULL, outcome_code text,
 ticks bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
