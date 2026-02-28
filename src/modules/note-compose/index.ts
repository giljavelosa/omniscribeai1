import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const composeSchema = z.object({
  sessionId: z.string(),
  division: z.enum(['medical', 'rehab', 'bh']),
  noteFamily: z.string()
});

export const noteComposeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/note-compose', async (req, reply) => {
    const parsed = composeSchema.parse(req.body);
    return reply.send({ ok: true, data: { sessionId: parsed.sessionId, status: 'draft_created' } });
  });
};
