import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';

export const correlationIdPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-correlation-id'];
    const correlationId = Array.isArray(incoming)
      ? incoming[0]
      : incoming || randomUUID();

    req.headers['x-correlation-id'] = correlationId;
    reply.header('x-correlation-id', correlationId);
  });
};
