import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const writebackSchema = z
  .object({
    noteId: z.string().trim().min(1).max(128),
    ehr: z.enum(['nextgen', 'webpt'])
  })
  .strict();

export const writebackRoutes: FastifyPluginAsync = async (app) => {
  app.post('/writeback/jobs', async (req, reply) => {
    const parsed = writebackSchema.parse(req.body);
    return reply.send({
      ok: true,
      data: {
        noteId: parsed.noteId,
        ehr: parsed.ehr,
        status: 'queued'
      }
    });
  });
};
