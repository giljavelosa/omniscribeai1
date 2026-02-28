import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const validateSchema = z.object({
  noteId: z.string(),
  division: z.enum(['medical', 'rehab', 'bh'])
});

export const validationGateRoutes: FastifyPluginAsync = async (app) => {
  app.post('/validation-gate', async (req, reply) => {
    const parsed = validateSchema.parse(req.body);
    return reply.send({
      ok: true,
      data: {
        noteId: parsed.noteId,
        status: 'needs_review',
        unsupportedStatementRate: 0
      }
    });
  });
};
