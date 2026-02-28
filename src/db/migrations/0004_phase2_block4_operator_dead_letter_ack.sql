ALTER TABLE writeback_jobs
  ADD COLUMN IF NOT EXISTS operator_status TEXT NOT NULL DEFAULT 'open';

UPDATE writeback_jobs
SET operator_status = 'open'
WHERE operator_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_writeback_jobs_operator_status ON writeback_jobs(operator_status);
