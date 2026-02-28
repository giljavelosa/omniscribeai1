import 'fastify';
import type { FactExtractionQueue } from '../queue/factExtractionQueue.js';
import type { RepositoryBundle } from '../repositories/contracts.js';

declare module 'fastify' {
  interface FastifyInstance {
    repositories: RepositoryBundle;
    factExtractionQueue: FactExtractionQueue;
  }
}
