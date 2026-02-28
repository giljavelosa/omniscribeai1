import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { runMigrations } from '../db/migrator.js';
import { closePool, getPool } from '../db/pool.js';
import { createFactExtractionQueue } from '../queue/factExtractionQueue.js';
import { createRepositories } from '../repositories/index.js';
import { createFactExtractionWorker } from '../workers/factExtractionWorker.js';
import { createWritebackWorkerStub } from '../workers/writebackWorker.js';

async function canReachRedis(redisUrl: string): Promise<boolean> {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 500
  });
  client.on('error', () => {
    // handled by fallback decision
  });

  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

const dataLayer: FastifyPluginAsync = async (app) => {
  let pool = getPool();
  let migrationResult: { ran: boolean; applied: string[] } = { ran: false, applied: [] };

  if (pool) {
    try {
      migrationResult = await runMigrations();
    } catch (error) {
      if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
        app.log.warn(
          {
            error: error instanceof Error ? error.message : String(error)
          },
          'database unavailable; falling back to in-memory repositories for this runtime'
        );
        await closePool();
        pool = null;
      } else {
        throw error;
      }
    }
  }

  const repositories = createRepositories(pool);
  const redisReachable = env.REDIS_URL ? await canReachRedis(env.REDIS_URL) : false;
  const factExtractionQueue = createFactExtractionQueue({
    forceInMemory: Boolean(env.REDIS_URL) && !redisReachable
  });
  const writebackWorker = createWritebackWorkerStub();
  factExtractionQueue.registerProcessor(createFactExtractionWorker(repositories));
  await writebackWorker.start();

  if (!pool) {
    if (!env.DATABASE_URL) {
      app.log.warn('DATABASE_URL is not configured; running with in-memory repositories (non-persistent)');
    } else {
      app.log.warn('DATABASE_URL is configured but unavailable; running with in-memory repositories');
    }
  } else if (migrationResult.applied.length > 0) {
    app.log.info({ applied: migrationResult.applied }, 'database migrations applied');
  } else {
    app.log.info('database ready; no new migrations');
  }

  if (factExtractionQueue.mode === 'in_memory') {
    if (!env.REDIS_URL) {
      app.log.warn('REDIS_URL is not configured; using in-memory fact extraction fallback');
    } else {
      app.log.warn('REDIS_URL is configured but unavailable; using in-memory fact extraction fallback');
    }
  } else {
    app.log.info('fact extraction queue initialized with BullMQ');
  }

  app.decorate('repositories', repositories);
  app.decorate('factExtractionQueue', factExtractionQueue);

  app.addHook('onClose', async () => {
    await writebackWorker.stop();
    await factExtractionQueue.close();
    await closePool();
  });
};

export const dataLayerPlugin = fp(dataLayer);
