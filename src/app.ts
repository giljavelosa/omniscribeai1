import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { correlationIdPlugin } from './plugins/correlationId.js';
import { securityLoggingPlugin } from './plugins/securityLogging.js';
import { errorEnvelopePlugin } from './plugins/errorEnvelope.js';
import { transcriptIngestRoutes } from './modules/transcript-ingest/index.js';
import { factLedgerRoutes } from './modules/fact-ledger/index.js';
import { noteComposeRoutes } from './modules/note-compose/index.js';
import { validationGateRoutes } from './modules/validation-gate/index.js';
import { writebackRoutes } from './modules/writeback/index.js';

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { colorize: true }
            }
          : undefined
    }
  });

  app.register(cors);
  app.register(correlationIdPlugin);
  app.register(securityLoggingPlugin);
  app.register(errorEnvelopePlugin);

  app.get('/health', async () => ({ ok: true, service: 'omniscribeai1-api' }));

  app.register(transcriptIngestRoutes, { prefix: '/api/v1' });
  app.register(factLedgerRoutes, { prefix: '/api/v1' });
  app.register(noteComposeRoutes, { prefix: '/api/v1' });
  app.register(validationGateRoutes, { prefix: '/api/v1' });
  app.register(writebackRoutes, { prefix: '/api/v1' });

  return app;
}
