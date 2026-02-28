import { randomUUID } from 'node:crypto';
import type { FactExtractionJob } from '../queue/factExtractionQueue.js';
import type { RepositoryBundle } from '../repositories/contracts.js';

export type FactExtractionOutcome = {
  factsCreated: number;
};

export function createFactExtractionWorker(repositories: RepositoryBundle) {
  return async (job: FactExtractionJob): Promise<FactExtractionOutcome> => {
    try {
      await repositories.sessions.updateStatus(job.sessionId, 'fact_extraction_in_progress');

      const [segments, existingFacts] = await Promise.all([
        repositories.segments.listBySession(job.sessionId),
        repositories.facts.listBySession(job.sessionId)
      ]);

      const existingSegmentIds = new Set(
        existingFacts
          .map((fact) => fact.transcriptSegmentId)
          .filter((segmentId): segmentId is string => Boolean(segmentId))
      );

      let factsCreated = 0;
      for (const segment of segments) {
        if (existingSegmentIds.has(segment.segmentId)) {
          continue;
        }

        await repositories.facts.insert({
          entryId: randomUUID(),
          sessionId: segment.sessionId,
          transcriptSegmentId: segment.segmentId,
          factType: 'transcript_observation',
          factValue: {
            speaker: segment.speaker,
            text: segment.text,
            startMs: segment.startMs,
            endMs: segment.endMs
          },
          confidence: 1
        });
        factsCreated += 1;
      }

      await repositories.audit.insert({
        eventId: randomUUID(),
        sessionId: job.sessionId,
        noteId: null,
        eventType: 'fact_extraction_completed',
        actor: 'system',
        payload: {
          division: job.division,
          segmentsSeen: segments.length,
          factsCreated
        }
      });

      await repositories.sessions.updateStatus(job.sessionId, 'fact_extraction_completed');
      return { factsCreated };
    } catch (error) {
      await repositories.sessions.updateStatus(job.sessionId, 'fact_extraction_failed');
      await repositories.audit.insert({
        eventId: randomUUID(),
        sessionId: job.sessionId,
        noteId: null,
        eventType: 'fact_extraction_failed',
        actor: 'system',
        payload: {
          division: job.division,
          message: error instanceof Error ? error.message : 'unknown error'
        }
      });
      throw error;
    }
  };
}
