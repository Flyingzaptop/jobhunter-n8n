CREATE TABLE IF NOT EXISTS captcha_transport_tests (
 request_id uuid PRIMARY KEY,
 scope text NOT NULL DEFAULT 'TRANSPORT_TEST' CHECK(scope='TRANSPORT_TEST'),
 telegram_chat_id text NOT NULL,
 telegram_message_id bigint,
 status text NOT NULL CHECK(status IN ('PENDING','SENT','REPLIED','FAILED','DELIVERY_UNKNOWN')),
 created_at timestamptz NOT NULL DEFAULT now(),reply_received_at timestamptz,
 error_code text
);
ALTER TABLE captcha_transport_tests ADD COLUMN IF NOT EXISTS code_salt text;
ALTER TABLE captcha_transport_tests ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE captcha_transport_tests ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE captcha_transport_tests ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
