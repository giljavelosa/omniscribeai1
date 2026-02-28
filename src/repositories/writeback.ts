import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { MemoryStore } from './memoryStore.js';
import type { WritebackJob, WritebackRepository } from './contracts.js';

function toWritebackJob(row: Record<string, unknown>): WritebackJob {
  const value = mapTimestamps(row);
  return {
    jobId: String(value.job_id),
    noteId: String(value.note_id),
    ehr: value.ehr as WritebackJob['ehr'],
    status: String(value.status),
    attempts: Number(value.attempts),
    lastError: value.last_error ? String(value.last_error) : null,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at)
  };
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
          INSERT INTO writeback_jobs(job_id, note_id, ehr, status, attempts, last_error)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING job_id, note_id, ehr, status, attempts, last_error, created_at, updated_at
        `,
        [job.jobId, job.noteId, job.ehr, job.status, job.attempts, job.lastError]
      );

      return toWritebackJob(result.rows[0] as Record<string, unknown>);
    },

    async updateStatus(jobId, status, lastError) {
      if (!db) {
        const existing = store.writeback.get(jobId);
        if (!existing) {
          return;
        }

        store.writeback.set(jobId, {
          ...existing,
          status,
          lastError: lastError ?? existing.lastError,
          updatedAt: new Date().toISOString()
        });
        return;
      }

      await db.query(
        `
          UPDATE writeback_jobs
          SET status = $2,
              last_error = COALESCE($3, last_error),
              updated_at = NOW()
          WHERE job_id = $1
        `,
        [jobId, status, lastError ?? null]
      );
    }
  };
}
