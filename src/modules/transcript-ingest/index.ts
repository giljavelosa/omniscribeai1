import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const schema = z.object({
  sessionId: z.string(),
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
    return reply.send({ ok: true, data: { accepted: parsed.segments.length } });
  });
};
