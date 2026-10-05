CREATE TABLE IF NOT EXISTS pipeline_batches(batch_id uuid PRIMARY KEY,started_at timestamptz NOT NULL DEFAULT now(),active boolean NOT NULL DEFAULT true,discovery_paused boolean NOT NULL DEFAULT true);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_pipeline_batch ON pipeline_batches(active) WHERE active=true;
CREATE TABLE IF NOT EXISTS pipeline_batch_raw(batch_id uuid REFERENCES pipeline_batches,raw_id uuid REFERENCES jobs_raw,status text NOT NULL DEFAULT 'PENDING',job_id uuid,error_code text,PRIMARY KEY(batch_id,raw_id));
CREATE TABLE IF NOT EXISTS pipeline_batch_jobs(batch_id uuid REFERENCES pipeline_batches,job_id uuid REFERENCES jobs,PRIMARY KEY(batch_id,job_id));
CREATE INDEX IF NOT EXISTS job_sources_raw_mapping_idx ON job_sources(source_name,source_url);
