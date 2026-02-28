import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { ValidationRepository, ValidationResult } from './contracts.js';
import type { MemoryStore } from './memoryStore.js';

function toValidation(row: Record<string, unknown>): ValidationResult {
  const value = mapTimestamps(row);
  return {
    resultId: String(value.result_id),
    noteId: String(value.note_id),
    sessionId: String(value.session_id),
    decision: value.decision as ValidationResult['decision'],
    unsupportedStatementRate: Number(value.unsupported_statement_rate),
    reasons: Array.isArray(value.reasons) ? value.reasons.map((item) => String(item)) : [],
    details: value.details as Record<string, unknown>,
    createdAt: String(value.created_at)
  };
}

export function createValidationRepository(
  db: DbExecutor | null,
  store: MemoryStore
): ValidationRepository {
  return {
    async insert(result) {
      if (!db) {
        const created: ValidationResult = { ...result, createdAt: new Date().toISOString() };
        store.validation.set(result.resultId, created);
        return created;
      }

      const queryResult = await db.query(
        `
          INSERT INTO validation_results(
            result_id,
            note_id,
            session_id,
            decision,
            unsupported_statement_rate,
            reasons,
            details
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
          RETURNING result_id, note_id, session_id, decision, unsupported_statement_rate, reasons, details, created_at
        `,
        [
          result.resultId,
          result.noteId,
          result.sessionId,
          result.decision,
          result.unsupportedStatementRate,
          JSON.stringify(result.reasons),
          JSON.stringify(result.details)
        ]
      );

      return toValidation(queryResult.rows[0] as Record<string, unknown>);
    },

    async getLatestBySession(sessionId) {
      if (!db) {
        const matches = Array.from(store.validation.values())
          .filter((result) => result.sessionId === sessionId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return matches[matches.length - 1] ?? null;
      }

      const result = await db.query(
        `
          SELECT result_id, note_id, session_id, decision, unsupported_statement_rate, reasons, details, created_at
          FROM validation_results
          WHERE session_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [sessionId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return toValidation(result.rows[0] as Record<string, unknown>);
    },

    async getLatestByNote(noteId) {
      if (!db) {
        const matches = Array.from(store.validation.values())
          .filter((result) => result.noteId === noteId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return matches[matches.length - 1] ?? null;
      }

      const result = await db.query(
        `
          SELECT result_id, note_id, session_id, decision, unsupported_statement_rate, reasons, details, created_at
          FROM validation_results
          WHERE note_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [noteId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return toValidation(result.rows[0] as Record<string, unknown>);
    }
  };
}
