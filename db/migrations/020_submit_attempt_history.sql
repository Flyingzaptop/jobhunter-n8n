ALTER TABLE confirmed_submit_commands ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE confirmed_submit_commands ADD COLUMN IF NOT EXISTS superseded_reason text;
ALTER TABLE confirmed_submit_commands DROP CONSTRAINT IF EXISTS confirmed_submit_commands_application_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS confirmed_submit_one_active_attempt ON confirmed_submit_commands(application_id) WHERE superseded_at IS NULL;
