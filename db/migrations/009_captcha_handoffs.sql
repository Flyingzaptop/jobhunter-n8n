CREATE TABLE IF NOT EXISTS captcha_handoffs (
 handoff_id uuid PRIMARY KEY,
 application_id uuid NOT NULL REFERENCES applications,
 question_id uuid NOT NULL REFERENCES application_questions,
 browser_session_id uuid NOT NULL,
 form_fingerprint text NOT NULL,
 official_url text NOT NULL,
 dashboard_url text NOT NULL,
 delivery_status text NOT NULL DEFAULT 'PENDING'
  CHECK(delivery_status IN ('PENDING','WAITING_CONFIGURATION','DELIVERING','SENT','SENT_LINK_ONLY','FAILED','DELIVERY_UNKNOWN')),
 delivery_attempts integer NOT NULL DEFAULT 0,
 delivery_error_code text,
 telegram_message_id bigint,
 created_at timestamptz NOT NULL DEFAULT now(),
 delivery_started_at timestamptz,
 delivered_at timestamptz,
 UNIQUE(application_id,browser_session_id,form_fingerprint)
);
CREATE INDEX IF NOT EXISTS captcha_handoff_delivery_idx ON captcha_handoffs(delivery_status,created_at);
