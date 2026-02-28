import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const validateSchema = z
  .object({
    noteId: z.string().trim().min(1).max(128),
    division: z.enum(['medical', 'rehab', 'bh'])
  })
  .strict();

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
