import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';

const extractSchema = z.object({
  sessionId: z.string(),
  transcriptVersion: z.number().default(1)
});

export const factLedgerRoutes: FastifyPluginAsync = async (app) => {
  app.post('/fact-ledger/extract', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = extractSchema.parse(req.body);
    return reply.send({ ok: true, data: { sessionId: parsed.sessionId, factsCreated: 0 } });
  });
};
