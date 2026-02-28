export type Division = 'medical' | 'rehab' | 'bh';
export type Speaker = 'clinician' | 'patient' | 'unknown';

export type EncounterSession = {
  sessionId: string;
  division: Division;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastIngestedAt: string | null;
};

export type TranscriptSegment = {
  sessionId: string;
  segmentId: string;
  speaker: Speaker;
  startMs: number;
  endMs: number;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type FactLedgerEntry = {
  entryId: string;
  sessionId: string;
  transcriptSegmentId: string | null;
  factType: string;
  factValue: Record<string, unknown>;
  confidence: number | null;
  createdAt: string;
};

export type ComposedNote = {
  noteId: string;
  sessionId: string;
  division: Division;
  noteFamily: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ValidationDecision = 'approved_for_writeback' | 'needs_review' | 'blocked';

export type ValidationResult = {
  resultId: string;
  noteId: string;
  sessionId: string;
  decision: ValidationDecision;
  unsupportedStatementRate: number;
  reasons: string[];
  details: Record<string, unknown>;
  createdAt: string;
};

export type WritebackAttempt = {
  attempt: number;
  fromStatus: string;
  toStatus: string;
  error: string;
  errorDetail: Record<string, unknown> | null;
  occurredAt: string;
};

export type WritebackJob = {
  jobId: string;
  noteId: string;
  ehr: 'nextgen' | 'webpt';
  idempotencyKey: string;
  replayOfJobId: string | null;
  replayedJobId: string | null;
  operatorStatus: 'open' | 'acknowledged';
  status: string;
  attempts: number;
  lastError: string | null;
  lastErrorDetail: Record<string, unknown> | null;
  attemptHistory: WritebackAttempt[];
  createdAt: string;
  updatedAt: string;
};

export type AuditEvent = {
  eventId: string;
  sessionId: string | null;
  noteId: string | null;
  eventType: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export interface SessionsRepository {
  upsert(input: { sessionId: string; division: Division; status?: string }): Promise<EncounterSession>;
  getById(sessionId: string): Promise<EncounterSession | null>;
  updateStatus(sessionId: string, status: string): Promise<void>;
}

export interface SegmentsRepository {
  upsertMany(segments: Array<Omit<TranscriptSegment, 'createdAt' | 'updatedAt'>>): Promise<{ upserted: number }>;
  countBySession(sessionId: string): Promise<number>;
  listBySession(sessionId: string): Promise<TranscriptSegment[]>;
}

export interface FactsRepository {
  insert(entry: Omit<FactLedgerEntry, 'createdAt'>): Promise<FactLedgerEntry>;
  listBySession(sessionId: string): Promise<FactLedgerEntry[]>;
}

export interface NotesRepository {
  insert(note: Omit<ComposedNote, 'createdAt' | 'updatedAt'>): Promise<ComposedNote>;
  getById(noteId: string): Promise<ComposedNote | null>;
  updateStatus(noteId: string, status: string): Promise<void>;
}

export interface ValidationRepository {
  insert(result: Omit<ValidationResult, 'createdAt'>): Promise<ValidationResult>;
  getLatestBySession(sessionId: string): Promise<ValidationResult | null>;
  getLatestByNote(noteId: string): Promise<ValidationResult | null>;
}

export type WritebackListFilters = {
  state?: string;
  noteId?: string;
  limit?: number;
};

export type DeadLetterListFilters = {
  status?: 'retryable_failed' | 'dead_failed' | 'failed';
  reason?: string;
  limit?: number;
};

export type WritebackStatusSummary = {
  countsByStatus: Record<string, number>;
  deadLetterOperatorCounts: {
    open: number;
    acknowledged: number;
  };
  recentFailures: {
    since: string;
    total: number;
    retryable: number;
    nonRetryable: number;
    unknown: number;
    byReasonCode: Record<string, number>;
  };
};

export type WritebackStatusUpdate = {
  lastError?: string | null;
  lastErrorDetail?: Record<string, unknown> | null;
  attempts?: number;
  attemptHistory?: WritebackAttempt[];
};

export type DeadLetterReplayInsert = {
  jobId: string;
  noteId: string;
  ehr: WritebackJob['ehr'];
  idempotencyKey: string;
  operatorStatus: WritebackJob['operatorStatus'];
  status: string;
  attempts: number;
  lastError: string | null;
  lastErrorDetail: Record<string, unknown> | null;
  attemptHistory: WritebackAttempt[];
};

export type DeadLetterReplayCreateResult =
  | { outcome: 'created'; originalJobId: string; replayJob: WritebackJob }
  | { outcome: 'already_replayed'; originalJobId: string; existingReplayJobId: string | null }
  | { outcome: 'original_not_found'; originalJobId: string };

export interface WritebackRepository {
  insert(job: Omit<WritebackJob, 'createdAt' | 'updatedAt'>): Promise<WritebackJob>;
  getById(jobId: string): Promise<WritebackJob | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<WritebackJob | null>;
  list(filters: WritebackListFilters): Promise<WritebackJob[]>;
  listDeadLetters(filters: DeadLetterListFilters): Promise<WritebackJob[]>;
  getStatusSummary(sinceIso: string): Promise<WritebackStatusSummary>;
  updateOperatorStatus(jobId: string, operatorStatus: WritebackJob['operatorStatus']): Promise<void>;
  updateStatus(jobId: string, status: string, update?: WritebackStatusUpdate): Promise<void>;
  linkReplay(originalJobId: string, replayJobId: string): Promise<void>;
  createDeadLetterReplay(
    originalJobId: string,
    replayJob: DeadLetterReplayInsert
  ): Promise<DeadLetterReplayCreateResult>;
}

export interface AuditRepository {
  insert(event: Omit<AuditEvent, 'createdAt'>): Promise<AuditEvent>;
  listBySession(sessionId: string): Promise<AuditEvent[]>;
  listByNote(noteId: string): Promise<AuditEvent[]>;
}

export interface RepositoryBundle {
  sessions: SessionsRepository;
  segments: SegmentsRepository;
  facts: FactsRepository;
  notes: NotesRepository;
  validation: ValidationRepository;
  writeback: WritebackRepository;
  audit: AuditRepository;
}
