import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const composeSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(128),
    division: z.enum(['medical', 'rehab', 'bh']),
    noteFamily: z.string().trim().min(1).max(64)
  })
  .strict();

export const noteComposeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/note-compose', async (req, reply) => {
    const parsed = composeSchema.parse(req.body);
    return reply.send({ ok: true, data: { sessionId: parsed.sessionId, status: 'draft_created' } });
  });
};
