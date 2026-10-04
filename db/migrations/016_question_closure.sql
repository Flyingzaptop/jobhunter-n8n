ALTER TABLE application_questions ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE application_questions ADD COLUMN IF NOT EXISTS closed_reason text;
