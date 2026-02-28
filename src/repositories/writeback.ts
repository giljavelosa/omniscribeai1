import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { MemoryStore } from './memoryStore.js';
import type {
  WritebackAttempt,
  WritebackJob,
  WritebackListFilters,
  WritebackRepository
} from './contracts.js';

function toAttemptHistory(value: unknown): WritebackAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const safe = (item ?? {}) as Record<string, unknown>;
    return {
      attempt: Number(safe.attempt),
      fromStatus: String(safe.fromStatus),
      toStatus: String(safe.toStatus),
      error: String(safe.error),
      errorDetail: safe.errorDetail ? (safe.errorDetail as Record<string, unknown>) : null,
      occurredAt: String(safe.occurredAt)
    };
  });
}

function toWritebackJob(row: Record<string, unknown>): WritebackJob {
  const value = mapTimestamps(row);
  return {
    jobId: String(value.job_id),
    noteId: String(value.note_id),
    ehr: value.ehr as WritebackJob['ehr'],
    idempotencyKey: String(value.idempotency_key),
    status: String(value.status),
    attempts: Number(value.attempts),
    lastError: value.last_error ? String(value.last_error) : null,
    lastErrorDetail: value.last_error_detail
      ? (value.last_error_detail as Record<string, unknown>)
      : null,
    attemptHistory: toAttemptHistory(value.attempt_history),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at)
  };
}

function applyListFilters(jobs: WritebackJob[], filters: WritebackListFilters): WritebackJob[] {
  const stateFilter = filters.state?.trim();
  const noteIdFilter = filters.noteId?.trim();
  const limit = filters.limit ?? 50;

  return jobs
    .filter((job) => (stateFilter ? job.status === stateFilter : true))
    .filter((job) => (noteIdFilter ? job.noteId === noteIdFilter : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function createWritebackRepository(
  db: DbExecutor | null,
  store: MemoryStore
): WritebackRepository {
  return {
    async insert(job) {
      if (!db) {
        const now = new Date().toISOString();
        const created: WritebackJob = { ...job, createdAt: now, updatedAt: now };
        store.writeback.set(job.jobId, created);
        return created;
      }

      const result = await db.query(
        `
          INSERT INTO writeback_jobs(
            job_id,
            note_id,
            ehr,
            idempotency_key,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
          RETURNING
            job_id,
            note_id,
            ehr,
            idempotency_key,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history,
            created_at,
            updated_at
        `,
        [
          job.jobId,
          job.noteId,
          job.ehr,
          job.idempotencyKey,
          job.status,
          job.attempts,
          job.lastError,
          JSON.stringify(job.lastErrorDetail),
          JSON.stringify(job.attemptHistory)
        ]
      );

      return toWritebackJob(result.rows[0] as Record<string, unknown>);
    },

    async getById(jobId) {
      if (!db) {
        return store.writeback.get(jobId) ?? null;
      }

      const result = await db.query(
        `
          SELECT
            job_id,
            note_id,
            ehr,
            idempotency_key,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history,
            created_at,
            updated_at
          FROM writeback_jobs
          WHERE job_id = $1
        `,
        [jobId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return toWritebackJob(result.rows[0] as Record<string, unknown>);
    },

    async getByIdempotencyKey(idempotencyKey) {
      if (!db) {
        const found = Array.from(store.writeback.values()).find(
          (job) => job.idempotencyKey === idempotencyKey
        );
        return found ?? null;
      }

      const result = await db.query(
        `
          SELECT
            job_id,
            note_id,
            ehr,
            idempotency_key,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history,
            created_at,
            updated_at
          FROM writeback_jobs
          WHERE idempotency_key = $1
          LIMIT 1
        `,
        [idempotencyKey]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return toWritebackJob(result.rows[0] as Record<string, unknown>);
    },

    async list(filters) {
      if (!db) {
        return applyListFilters(Array.from(store.writeback.values()), filters);
      }

      const whereParts: string[] = [];
      const params: Array<string | number> = [];

      if (filters.state?.trim()) {
        params.push(filters.state.trim());
        whereParts.push(`status = $${params.length}`);
      }

      if (filters.noteId?.trim()) {
        params.push(filters.noteId.trim());
        whereParts.push(`note_id = $${params.length}`);
      }

      const requestedLimit = filters.limit ?? 50;
      const safeLimit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
      params.push(safeLimit);

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const result = await db.query(
        `
          SELECT
            job_id,
            note_id,
            ehr,
            idempotency_key,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history,
            created_at,
            updated_at
          FROM writeback_jobs
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${params.length}
        `,
        params
      );

      return result.rows.map((row) => toWritebackJob(row as Record<string, unknown>));
    },

    async updateStatus(jobId, status, update) {
      if (!db) {
        const existing = store.writeback.get(jobId);
        if (!existing) {
          return;
        }

        store.writeback.set(jobId, {
          ...existing,
          status,
          attempts: update?.attempts ?? existing.attempts,
          lastError: update?.lastError === undefined ? existing.lastError : update.lastError,
          lastErrorDetail:
            update?.lastErrorDetail === undefined ? existing.lastErrorDetail : update.lastErrorDetail,
          attemptHistory:
            update?.attemptHistory === undefined ? existing.attemptHistory : update.attemptHistory,
          updatedAt: new Date().toISOString()
        });
        return;
      }

      await db.query(
        `
          UPDATE writeback_jobs
          SET status = $2,
              last_error = CASE WHEN $3 THEN $4 ELSE last_error END,
              last_error_detail = CASE WHEN $5 THEN $6::jsonb ELSE last_error_detail END,
              attempts = CASE WHEN $7 THEN $8 ELSE attempts END,
              attempt_history = CASE WHEN $9 THEN $10::jsonb ELSE attempt_history END,
              updated_at = NOW()
          WHERE job_id = $1
        `,
        [
          jobId,
          status,
          update?.lastError !== undefined,
          update?.lastError ?? null,
          update?.lastErrorDetail !== undefined,
          JSON.stringify(update?.lastErrorDetail ?? null),
          update?.attempts !== undefined,
          update?.attempts ?? null,
          update?.attemptHistory !== undefined,
          JSON.stringify(update?.attemptHistory ?? null)
        ]
      );
    }
  };
}
