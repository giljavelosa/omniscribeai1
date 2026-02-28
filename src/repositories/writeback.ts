import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { MemoryStore } from './memoryStore.js';
import type {
  DeadLetterReplayCreateResult,
  DeadLetterReplayInsert,
  DeadLetterListFilters,
  WritebackAttempt,
  WritebackJob,
  WritebackListFilters,
  WritebackRepository,
  WritebackStatusSummary
} from './contracts.js';
import { classifyWritebackFailureReason } from '../workers/writebackWorker.js';

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
    replayOfJobId: value.replay_of_job_id ? String(value.replay_of_job_id) : null,
    replayedJobId: value.replayed_job_id ? String(value.replayed_job_id) : null,
    operatorStatus: value.operator_status === 'acknowledged' ? 'acknowledged' : 'open',
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

function applyDeadLetterFilters(jobs: WritebackJob[], filters: DeadLetterListFilters): WritebackJob[] {
  const statusFilter = filters.status?.trim();
  const reasonFilter = filters.reason?.trim().toUpperCase();
  const limit = filters.limit ?? 50;

  return jobs
    .filter((job) => ['retryable_failed', 'dead_failed', 'failed'].includes(job.status))
    .filter((job) => (statusFilter ? job.status === statusFilter : true))
    .filter((job) => {
      if (!reasonFilter) {
        return true;
      }
      return toReasonCode(job.lastErrorDetail) === reasonFilter;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function emptySummary(sinceIso: string): WritebackStatusSummary {
  return {
    countsByStatus: {},
    deadLetterOperatorCounts: {
      open: 0,
      acknowledged: 0
    },
    recentFailures: {
      since: sinceIso,
      total: 0,
      retryable: 0,
      nonRetryable: 0,
      unknown: 0,
      byReasonCode: {}
    }
  };
}

function toReasonCode(errorDetail: Record<string, unknown> | null): string | null {
  if (!errorDetail) {
    return null;
  }

  const reasonCandidate = errorDetail.reasonCode ?? errorDetail.code;
  if (typeof reasonCandidate !== 'string') {
    return null;
  }

  const normalized = reasonCandidate.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function createWritebackRepository(
  db: DbExecutor | null,
  store: MemoryStore
): WritebackRepository {
  return {
    async insert(job) {
      if (!db) {
        const replayOfJobId = job.replayOfJobId?.trim();
        if (replayOfJobId) {
          const existingReplay = Array.from(store.writeback.values()).find(
            (existing) => existing.replayOfJobId === replayOfJobId
          );
          if (existingReplay) {
            const error = new Error(`duplicate replay_of_job_id for ${replayOfJobId}`) as Error & {
              code?: string;
              constraint?: string;
            };
            error.code = '23505';
            error.constraint = 'uniq_writeback_jobs_replay_of_job_id';
            throw error;
          }
        }

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
            replay_of_job_id,
            replayed_job_id,
            operator_status,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
          RETURNING
            job_id,
            note_id,
            ehr,
            idempotency_key,
            replay_of_job_id,
            replayed_job_id,
            operator_status,
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
          job.replayOfJobId,
          job.replayedJobId,
          job.operatorStatus,
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
            replay_of_job_id,
            replayed_job_id,
            operator_status,
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
            replay_of_job_id,
            replayed_job_id,
            operator_status,
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
            replay_of_job_id,
            replayed_job_id,
            operator_status,
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

    async listDeadLetters(filters) {
      if (!db) {
        return applyDeadLetterFilters(Array.from(store.writeback.values()), filters);
      }

      const whereParts = [`status IN ('retryable_failed', 'dead_failed', 'failed')`];
      const params: Array<string | number> = [];

      if (filters.status?.trim()) {
        params.push(filters.status.trim());
        whereParts.push(`status = $${params.length}`);
      }

      if (filters.reason?.trim()) {
        params.push(filters.reason.trim().toUpperCase());
        whereParts.push(
          `COALESCE(NULLIF(UPPER(TRIM(last_error_detail->>'reasonCode')), ''), NULLIF(UPPER(TRIM(last_error_detail->>'code')), '')) = $${params.length}`
        );
      }

      const requestedLimit = filters.limit ?? 50;
      const safeLimit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 100);
      params.push(safeLimit);

      const result = await db.query(
        `
          SELECT
            job_id,
            note_id,
            ehr,
            idempotency_key,
            replay_of_job_id,
            replayed_job_id,
            operator_status,
            status,
            attempts,
            last_error,
            last_error_detail,
            attempt_history,
            created_at,
            updated_at
          FROM writeback_jobs
          WHERE ${whereParts.join(' AND ')}
          ORDER BY updated_at DESC
          LIMIT $${params.length}
        `,
        params
      );

      return result.rows.map((row) => toWritebackJob(row as Record<string, unknown>));
    },

    async getStatusSummary(sinceIso) {
      if (!db) {
        const summary = emptySummary(sinceIso);
        const sinceTs = new Date(sinceIso).getTime();

        for (const job of store.writeback.values()) {
          summary.countsByStatus[job.status] = (summary.countsByStatus[job.status] ?? 0) + 1;
          if (['retryable_failed', 'dead_failed', 'failed'].includes(job.status)) {
            summary.deadLetterOperatorCounts[job.operatorStatus] += 1;
          }

          for (const attempt of job.attemptHistory) {
            const occurredAtTs = new Date(attempt.occurredAt).getTime();
            if (Number.isNaN(occurredAtTs) || occurredAtTs < sinceTs) {
              continue;
            }

            summary.recentFailures.total += 1;

            const reasonCode = toReasonCode(attempt.errorDetail);
            if (reasonCode) {
              summary.recentFailures.byReasonCode[reasonCode] =
                (summary.recentFailures.byReasonCode[reasonCode] ?? 0) + 1;
            }

            const classification = classifyWritebackFailureReason(reasonCode);
            if (classification === 'retryable') {
              summary.recentFailures.retryable += 1;
            } else if (classification === 'non_retryable') {
              summary.recentFailures.nonRetryable += 1;
            } else {
              summary.recentFailures.unknown += 1;
            }
          }
        }

        return summary;
      }

      const countsResult = await db.query(
        `
          SELECT status, COUNT(*)::int AS count
          FROM writeback_jobs
          GROUP BY status
        `
      );
      const deadLetterOperatorCountsResult = await db.query(
        `
          SELECT operator_status, COUNT(*)::int AS count
          FROM writeback_jobs
          WHERE status IN ('retryable_failed', 'dead_failed', 'failed')
          GROUP BY operator_status
        `
      );

      const failuresResult = await db.query(
        `
          SELECT
            COALESCE(NULLIF(UPPER(TRIM(attempt_elem->'errorDetail'->>'reasonCode')), ''), NULLIF(UPPER(TRIM(attempt_elem->'errorDetail'->>'code')), '')) AS reason_code
          FROM writeback_jobs,
               LATERAL jsonb_array_elements(attempt_history) AS attempt_elem
          WHERE (attempt_elem->>'occurredAt')::timestamptz >= $1::timestamptz
        `,
        [sinceIso]
      );

      const summary = emptySummary(sinceIso);
      for (const row of countsResult.rows as Array<Record<string, unknown>>) {
        const status = String(row.status);
        const count = Number(row.count);
        summary.countsByStatus[status] = count;
      }
      for (const row of deadLetterOperatorCountsResult.rows as Array<Record<string, unknown>>) {
        const operatorStatus = row.operator_status === 'acknowledged' ? 'acknowledged' : 'open';
        const count = Number(row.count);
        summary.deadLetterOperatorCounts[operatorStatus] = count;
      }

      for (const row of failuresResult.rows as Array<Record<string, unknown>>) {
        const reasonCode = row.reason_code ? String(row.reason_code) : null;
        summary.recentFailures.total += 1;

        if (reasonCode) {
          summary.recentFailures.byReasonCode[reasonCode] =
            (summary.recentFailures.byReasonCode[reasonCode] ?? 0) + 1;
        }

        const classification = classifyWritebackFailureReason(reasonCode);
        if (classification === 'retryable') {
          summary.recentFailures.retryable += 1;
        } else if (classification === 'non_retryable') {
          summary.recentFailures.nonRetryable += 1;
        } else {
          summary.recentFailures.unknown += 1;
        }
      }

      return summary;
    },

    async updateOperatorStatus(jobId, operatorStatus) {
      if (!db) {
        const existing = store.writeback.get(jobId);
        if (!existing) {
          return;
        }

        store.writeback.set(jobId, {
          ...existing,
          operatorStatus,
          updatedAt: new Date().toISOString()
        });
        return;
      }

      await db.query(
        `
          UPDATE writeback_jobs
          SET operator_status = $2,
              updated_at = NOW()
          WHERE job_id = $1
        `,
        [jobId, operatorStatus]
      );
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
    },

    async createDeadLetterReplay(originalJobId: string, replayJob: DeadLetterReplayInsert) {
      if (!db) {
        const original = store.writeback.get(originalJobId);
        if (!original) {
          return {
            outcome: 'original_not_found',
            originalJobId
          } satisfies DeadLetterReplayCreateResult;
        }

        if (original.replayedJobId) {
          return {
            outcome: 'already_replayed',
            originalJobId,
            existingReplayJobId: original.replayedJobId
          } satisfies DeadLetterReplayCreateResult;
        }

        const now = new Date().toISOString();
        const createdReplay: WritebackJob = {
          ...replayJob,
          replayOfJobId: originalJobId,
          replayedJobId: null,
          createdAt: now,
          updatedAt: now
        };

        store.writeback.set(replayJob.jobId, createdReplay);
        store.writeback.set(originalJobId, {
          ...original,
          replayedJobId: replayJob.jobId,
          updatedAt: now
        });

        return {
          outcome: 'created',
          originalJobId,
          replayJob: createdReplay
        } satisfies DeadLetterReplayCreateResult;
      }

      const result = await db.query(
        `
          WITH original AS (
            SELECT job_id, replayed_job_id
            FROM writeback_jobs
            WHERE job_id = $1
          ),
          claim AS (
            UPDATE writeback_jobs
            SET replayed_job_id = $2,
                updated_at = NOW()
            WHERE job_id = $1
              AND replayed_job_id IS NULL
            RETURNING job_id
          ),
          inserted AS (
            INSERT INTO writeback_jobs(
              job_id,
              note_id,
              ehr,
              idempotency_key,
              replay_of_job_id,
              replayed_job_id,
              operator_status,
              status,
              attempts,
              last_error,
              last_error_detail,
              attempt_history
            )
            SELECT
              $2,
              $3,
              $4,
              $5,
              $1,
              NULL,
              $6,
              $7,
              $8,
              $9,
              $10::jsonb,
              $11::jsonb
            FROM claim
            RETURNING
              job_id,
              note_id,
              ehr,
              idempotency_key,
              replay_of_job_id,
              replayed_job_id,
              operator_status,
              status,
              attempts,
              last_error,
              last_error_detail,
              attempt_history,
              created_at,
              updated_at
          )
          SELECT
            (SELECT COUNT(*)::int FROM original) AS original_count,
            (SELECT replayed_job_id FROM original LIMIT 1) AS existing_replayed_job_id,
            (SELECT COUNT(*)::int FROM claim) AS claim_count,
            (SELECT row_to_json(inserted) FROM inserted LIMIT 1) AS replay_job
        `,
        [
          originalJobId,
          replayJob.jobId,
          replayJob.noteId,
          replayJob.ehr,
          replayJob.idempotencyKey,
          replayJob.operatorStatus,
          replayJob.status,
          replayJob.attempts,
          replayJob.lastError,
          JSON.stringify(replayJob.lastErrorDetail),
          JSON.stringify(replayJob.attemptHistory)
        ]
      );

      const row = result.rows[0] as Record<string, unknown>;
      const originalCount = Number(row.original_count);
      const claimCount = Number(row.claim_count);
      const existingReplayJobId =
        typeof row.existing_replayed_job_id === 'string' ? row.existing_replayed_job_id : null;

      if (originalCount === 0) {
        return {
          outcome: 'original_not_found',
          originalJobId
        } satisfies DeadLetterReplayCreateResult;
      }

      if (claimCount === 0) {
        return {
          outcome: 'already_replayed',
          originalJobId,
          existingReplayJobId
        } satisfies DeadLetterReplayCreateResult;
      }

      const replayRow = row.replay_job as Record<string, unknown> | null;
      if (!replayRow) {
        throw new Error(
          `writeback replay insert failed after replay link claim: originalJobId=${originalJobId}, replayJobId=${replayJob.jobId}`
        );
      }

      return {
        outcome: 'created',
        originalJobId,
        replayJob: toWritebackJob(replayRow)
      } satisfies DeadLetterReplayCreateResult;
    },

    async linkReplay(originalJobId, replayJobId) {
      if (!db) {
        const original = store.writeback.get(originalJobId);
        if (original) {
          store.writeback.set(originalJobId, {
            ...original,
            replayedJobId: replayJobId,
            updatedAt: new Date().toISOString()
          });
        }

        const replay = store.writeback.get(replayJobId);
        if (replay) {
          store.writeback.set(replayJobId, {
            ...replay,
            replayOfJobId: originalJobId,
            updatedAt: new Date().toISOString()
          });
        }
        return;
      }

      await db.query(
        `
          UPDATE writeback_jobs
          SET replayed_job_id = $2,
              updated_at = NOW()
          WHERE job_id = $1
        `,
        [originalJobId, replayJobId]
      );

      await db.query(
        `
          UPDATE writeback_jobs
          SET replay_of_job_id = $2,
              updated_at = NOW()
          WHERE job_id = $1
        `,
        [replayJobId, originalJobId]
      );
    }
  };
}
