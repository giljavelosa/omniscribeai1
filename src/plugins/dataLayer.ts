import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { runMigrations } from '../db/migrator.js';
import { closePool, getPool } from '../db/pool.js';
import { createFactExtractionQueue } from '../queue/factExtractionQueue.js';
import { createRepositories } from '../repositories/index.js';

const dataLayer: FastifyPluginAsync = async (app) => {
  const pool = getPool();
  await runMigrations();

  const repositories = createRepositories(pool);
  const factExtractionQueue = createFactExtractionQueue();

  app.decorate('repositories', repositories);
  app.decorate('factExtractionQueue', factExtractionQueue);

  app.addHook('onClose', async () => {
    await factExtractionQueue.close();
    await closePool();
  });
};

export const dataLayerPlugin = fp(dataLayer);
