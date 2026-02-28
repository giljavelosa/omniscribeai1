import type { MemoryStore } from './memoryStore.js';
import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { EncounterSession, SessionsRepository } from './contracts.js';

function toSession(row: Record<string, unknown>): EncounterSession {
  const value = mapTimestamps(row);
  return {
    sessionId: String(value.session_id),
    division: value.division as EncounterSession['division'],
    status: String(value.status),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    lastIngestedAt: value.last_ingested_at ? String(value.last_ingested_at) : null
  };
}

export function createSessionsRepository(db: DbExecutor | null, store: MemoryStore): SessionsRepository {
  return {
    async upsert(input) {
      if (!db) {
        const now = new Date().toISOString();
        const existing = store.sessions.get(input.sessionId);
        const next: EncounterSession = {
          sessionId: input.sessionId,
          division: input.division,
          status: input.status ?? existing?.status ?? 'ingesting',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          lastIngestedAt: now
        };
        store.sessions.set(input.sessionId, next);
        return next;
      }

      const result = await db.query(
        `
          INSERT INTO encounter_sessions(session_id, division, status, last_ingested_at)
          VALUES ($1, $2, COALESCE($3, 'ingesting'), NOW())
          ON CONFLICT(session_id)
          DO UPDATE SET
            division = EXCLUDED.division,
            status = COALESCE(EXCLUDED.status, encounter_sessions.status),
            last_ingested_at = NOW(),
            updated_at = NOW()
          RETURNING session_id, division, status, created_at, updated_at, last_ingested_at
        `,
        [input.sessionId, input.division, input.status ?? null]
      );
      return toSession(result.rows[0] as Record<string, unknown>);
    },

    async getById(sessionId) {
      if (!db) {
        return store.sessions.get(sessionId) ?? null;
      }

      const result = await db.query(
        `SELECT session_id, division, status, created_at, updated_at, last_ingested_at
         FROM encounter_sessions
         WHERE session_id = $1`,
        [sessionId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return toSession(result.rows[0] as Record<string, unknown>);
    },

    async updateStatus(sessionId, status) {
      if (!db) {
        const existing = store.sessions.get(sessionId);
        if (!existing) {
          return;
        }
        store.sessions.set(sessionId, {
          ...existing,
          status,
          updatedAt: new Date().toISOString()
        });
        return;
      }

      await db.query(
        `UPDATE encounter_sessions SET status = $2, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, status]
      );
    }
  };
}
