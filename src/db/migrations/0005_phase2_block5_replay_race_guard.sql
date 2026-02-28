CREATE UNIQUE INDEX IF NOT EXISTS uniq_writeback_jobs_replay_of_job_id
  ON writeback_jobs(replay_of_job_id)
  WHERE replay_of_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_writeback_jobs_replayed_job_id
  ON writeback_jobs(replayed_job_id)
  WHERE replayed_job_id IS NOT NULL;
