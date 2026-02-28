import { FastifyPluginAsync } from 'fastify';
import { redactSensitive } from '../lib/redaction.js';

export const securityLoggingPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req) => {
    req.log.info(
      {
        request: redactSensitive({
          method: req.method,
          url: req.url,
          headers: req.headers,
          query: req.query,
          params: req.params,
          body: req.body
        })
      },
      'request.received'
    );
  });
};

