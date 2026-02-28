import type { DbExecutor } from './db.js';
import type { MemoryStore } from './memoryStore.js';
import type { SegmentsRepository, TranscriptSegment } from './contracts.js';

type SegmentInput = Omit<TranscriptSegment, 'createdAt' | 'updatedAt'>;

export function createSegmentsRepository(db: DbExecutor | null, store: MemoryStore): SegmentsRepository {
  return {
    async upsertMany(segments) {
      if (!db) {
        for (const segment of segments) {
          let bySession = store.segments.get(segment.sessionId);
          if (!bySession) {
            bySession = new Map();
            store.segments.set(segment.sessionId, bySession);
          }

          const existing = bySession.get(segment.segmentId);
          const now = new Date().toISOString();

          bySession.set(segment.segmentId, {
            ...segment,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
          });
        }
        return { upserted: segments.length };
      }

      for (const segment of segments) {
        const value = segment as SegmentInput;
        await db.query(
          `
            INSERT INTO transcript_segments(session_id, segment_id, speaker, start_ms, end_ms, text)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT(session_id, segment_id)
            DO UPDATE SET
              speaker = EXCLUDED.speaker,
              start_ms = EXCLUDED.start_ms,
              end_ms = EXCLUDED.end_ms,
              text = EXCLUDED.text,
              updated_at = NOW()
          `,
          [value.sessionId, value.segmentId, value.speaker, value.startMs, value.endMs, value.text]
        );
      }

      return { upserted: segments.length };
    },

    async countBySession(sessionId) {
      if (!db) {
        return store.segments.get(sessionId)?.size ?? 0;
      }

      const result = await db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM transcript_segments WHERE session_id = $1',
        [sessionId]
      );

      return Number(result.rows[0].count);
    }
  };
}
