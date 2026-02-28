CREATE TABLE IF NOT EXISTS encounter_sessions (
  session_id TEXT PRIMARY KEY,
  division TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ingesting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ingested_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES encounter_sessions(session_id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, segment_id)
);

CREATE TABLE IF NOT EXISTS fact_ledger_entries (
  entry_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES encounter_sessions(session_id) ON DELETE CASCADE,
  transcript_segment_id TEXT,
  fact_type TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  confidence NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS composed_notes (
  note_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES encounter_sessions(session_id) ON DELETE CASCADE,
  division TEXT NOT NULL,
  note_family TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft_created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validation_results (
  result_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES encounter_sessions(session_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  unsupported_statement_rate NUMERIC(6,5) NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS writeback_jobs (
  job_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  ehr TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT,
  note_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_id ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_fact_ledger_entries_session_id ON fact_ledger_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_composed_notes_session_id ON composed_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_validation_results_session_id ON validation_results(session_id);
CREATE INDEX IF NOT EXISTS idx_writeback_jobs_note_id ON writeback_jobs(note_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_session_id ON audit_events(session_id);
