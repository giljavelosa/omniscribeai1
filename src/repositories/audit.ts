import type { AuditEvent, AuditRepository } from './contracts.js';
import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { MemoryStore } from './memoryStore.js';

function toAuditEvent(row: Record<string, unknown>): AuditEvent {
  const value = mapTimestamps(row);
  return {
    eventId: String(value.event_id),
    sessionId: value.session_id ? String(value.session_id) : null,
    noteId: value.note_id ? String(value.note_id) : null,
    eventType: String(value.event_type),
    actor: String(value.actor),
    payload: value.payload as Record<string, unknown>,
    createdAt: String(value.created_at)
  };
}

export function createAuditRepository(db: DbExecutor | null, store: MemoryStore): AuditRepository {
  return {
    async insert(event) {
      if (!db) {
        const created: AuditEvent = { ...event, createdAt: new Date().toISOString() };
        store.audit.set(event.eventId, created);
        return created;
      }

      const result = await db.query(
        `
          INSERT INTO audit_events(event_id, session_id, note_id, event_type, actor, payload)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          RETURNING event_id, session_id, note_id, event_type, actor, payload, created_at
        `,
        [
          event.eventId,
          event.sessionId,
          event.noteId,
          event.eventType,
          event.actor,
          JSON.stringify(event.payload)
        ]
      );

      return toAuditEvent(result.rows[0] as Record<string, unknown>);
    },

    async listBySession(sessionId) {
      if (!db) {
        return Array.from(store.audit.values()).filter((event) => event.sessionId === sessionId);
      }

      const result = await db.query(
        `
          SELECT event_id, session_id, note_id, event_type, actor, payload, created_at
          FROM audit_events
          WHERE session_id = $1
          ORDER BY created_at ASC
        `,
        [sessionId]
      );

      return result.rows.map((row) => toAuditEvent(row as Record<string, unknown>));
    }
  };
}
