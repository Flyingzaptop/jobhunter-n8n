ALTER TABLE telegram_processed_updates ADD COLUMN IF NOT EXISTS correlation_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE telegram_processed_updates ADD COLUMN IF NOT EXISTS dispatch_status text NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE telegram_processed_updates ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz;
ALTER TABLE telegram_processed_updates ADD COLUMN IF NOT EXISTS dispatch_completed_at timestamptz;
ALTER TABLE telegram_processed_updates ADD COLUMN IF NOT EXISTS dispatch_error_code text;
CREATE INDEX IF NOT EXISTS telegram_dispatch_pending_idx ON telegram_processed_updates(dispatch_status,processed_at);
ALTER TABLE application_questions ADD COLUMN IF NOT EXISTS telegram_chat_id text;
CREATE UNIQUE INDEX IF NOT EXISTS telegram_question_message_correlation_idx
 ON application_questions(telegram_chat_id,telegram_message_id)
 WHERE telegram_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL;
