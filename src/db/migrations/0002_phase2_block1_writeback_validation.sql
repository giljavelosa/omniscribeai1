ALTER TABLE writeback_jobs
  ADD COLUMN IF NOT EXISTS last_error_detail JSONB,
  ADD COLUMN IF NOT EXISTS attempt_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE validation_results
  ADD COLUMN IF NOT EXISTS reasons JSONB NOT NULL DEFAULT '[]'::jsonb;
