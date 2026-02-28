import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { ComposedNote, NotesRepository } from './contracts.js';
import type { MemoryStore } from './memoryStore.js';

function toNote(row: Record<string, unknown>): ComposedNote {
  const value = mapTimestamps(row);
  return {
    noteId: String(value.note_id),
    sessionId: String(value.session_id),
    division: value.division as ComposedNote['division'],
    noteFamily: String(value.note_family),
    body: String(value.body),
    status: String(value.status),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at)
  };
}

export function createNotesRepository(db: DbExecutor | null, store: MemoryStore): NotesRepository {
  return {
    async insert(note) {
      if (!db) {
        const now = new Date().toISOString();
        const created: ComposedNote = { ...note, createdAt: now, updatedAt: now };
        store.notes.set(note.noteId, created);
        return created;
      }

      const result = await db.query(
        `
          INSERT INTO composed_notes(note_id, session_id, division, note_family, body, status)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING note_id, session_id, division, note_family, body, status, created_at, updated_at
        `,
        [note.noteId, note.sessionId, note.division, note.noteFamily, note.body, note.status]
      );

      return toNote(result.rows[0] as Record<string, unknown>);
    },

    async getById(noteId) {
      if (!db) {
        return store.notes.get(noteId) ?? null;
      }

      const result = await db.query(
        `
          SELECT note_id, session_id, division, note_family, body, status, created_at, updated_at
          FROM composed_notes
          WHERE note_id = $1
        `,
        [noteId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return toNote(result.rows[0] as Record<string, unknown>);
    },

    async updateStatus(noteId, status) {
      if (!db) {
        const note = store.notes.get(noteId);
        if (!note) {
          return;
        }

        store.notes.set(noteId, {
          ...note,
          status,
          updatedAt: new Date().toISOString()
        });
        return;
      }

      await db.query(
        `
          UPDATE composed_notes
          SET status = $2,
              updated_at = NOW()
          WHERE note_id = $1
        `,
        [noteId, status]
      );
    }
  };
}
