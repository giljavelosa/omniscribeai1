import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  sessionId: z.string(),
  division: z.enum(['medical', 'rehab', 'bh']),
  segments: z.array(
    z.object({
      segmentId: z.string(),
      speaker: z.enum(['clinician', 'patient', 'unknown']),
      startMs: z.number(),
      endMs: z.number(),
      text: z.string()
    })
  )
});

export const transcriptIngestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/transcript-ingest', async (req, reply) => {
    const parsed = schema.parse(req.body);
    await app.repositories.sessions.upsert({
      sessionId: parsed.sessionId,
      division: parsed.division,
      status: 'ingesting'
    });

    await app.repositories.segments.upsertMany(
      parsed.segments.map((segment) => ({
        sessionId: parsed.sessionId,
        segmentId: segment.segmentId,
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text
      }))
    );

    const queueResult = await app.factExtractionQueue.enqueue({
      sessionId: parsed.sessionId,
      division: parsed.division
    });

    await app.repositories.audit.insert({
      eventId: randomUUID(),
      sessionId: parsed.sessionId,
      noteId: null,
      eventType: 'fact_extraction_queued',
      actor: 'system',
      payload: {
        jobId: queueResult.jobId,
        segmentCount: parsed.segments.length
      }
    });

    await app.repositories.sessions.updateStatus(parsed.sessionId, 'fact_extraction_queued');

    return reply.send({
      ok: true,
      data: {
        sessionId: parsed.sessionId,
        accepted: parsed.segments.length,
        division: parsed.division,
        factExtractionJobId: queueResult.jobId
      }
    });
  });
};
