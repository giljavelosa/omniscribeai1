import type { DbExecutor } from './db.js';
import { mapTimestamps } from './db.js';
import type { MemoryStore } from './memoryStore.js';
import type { FactLedgerEntry, FactsRepository } from './contracts.js';

function toFact(row: Record<string, unknown>): FactLedgerEntry {
  const value = mapTimestamps(row);
  return {
    entryId: String(value.entry_id),
    sessionId: String(value.session_id),
    transcriptSegmentId: value.transcript_segment_id ? String(value.transcript_segment_id) : null,
    factType: String(value.fact_type),
    factValue: value.fact_value as Record<string, unknown>,
    confidence: value.confidence === null ? null : Number(value.confidence),
    createdAt: String(value.created_at)
  };
}

export function createFactsRepository(db: DbExecutor | null, store: MemoryStore): FactsRepository {
  return {
    async insert(entry) {
      if (!db) {
        const created: FactLedgerEntry = { ...entry, createdAt: new Date().toISOString() };
        store.facts.set(entry.entryId, created);
        return created;
      }

      const result = await db.query(
        `
          INSERT INTO fact_ledger_entries(entry_id, session_id, transcript_segment_id, fact_type, fact_value, confidence)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6)
          RETURNING entry_id, session_id, transcript_segment_id, fact_type, fact_value, confidence, created_at
        `,
        [
          entry.entryId,
          entry.sessionId,
          entry.transcriptSegmentId,
          entry.factType,
          JSON.stringify(entry.factValue),
          entry.confidence
        ]
      );

      return toFact(result.rows[0] as Record<string, unknown>);
    },

    async listBySession(sessionId) {
      if (!db) {
        return Array.from(store.facts.values()).filter((entry) => entry.sessionId === sessionId);
      }

      const result = await db.query(
        `
          SELECT entry_id, session_id, transcript_segment_id, fact_type, fact_value, confidence, created_at
          FROM fact_ledger_entries
          WHERE session_id = $1
          ORDER BY created_at ASC
        `,
        [sessionId]
      );

      return result.rows.map((row) => toFact(row as Record<string, unknown>));
    }
  };
}
