ALTER TABLE writeback_jobs
  ADD COLUMN IF NOT EXISTS replay_of_job_id TEXT,
  ADD COLUMN IF NOT EXISTS replayed_job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_writeback_jobs_replay_of_job_id ON writeback_jobs(replay_of_job_id);
CREATE INDEX IF NOT EXISTS idx_writeback_jobs_replayed_job_id ON writeback_jobs(replayed_job_id);
