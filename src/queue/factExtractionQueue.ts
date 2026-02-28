import { Queue } from 'bullmq';
import { Worker } from 'bullmq';
import type { Division } from '../repositories/contracts.js';
import { env } from '../config/env.js';

export type FactExtractionJob = {
  sessionId: string;
  division: Division;
};

export type FactExtractionProcessor = (job: FactExtractionJob) => Promise<unknown>;

export interface FactExtractionQueue {
  readonly mode: 'bullmq' | 'in_memory';
  registerProcessor(processor: FactExtractionProcessor): void;
  enqueue(job: FactExtractionJob): Promise<{ queued: boolean; jobId: string }>;
  close(): Promise<void>;
}

class InMemoryFactExtractionQueue implements FactExtractionQueue {
  readonly mode = 'in_memory' as const;
  private processor?: FactExtractionProcessor;

  registerProcessor(processor: FactExtractionProcessor) {
    this.processor = processor;
  }

  async enqueue(job: FactExtractionJob) {
    const processor = this.processor;
    if (processor) {
      await processor(job);
    }

    return {
      queued: true,
      jobId: `${job.sessionId}:fact-extract`
    };
  }

  async close() {
    return;
  }
}

class BullFactExtractionQueue implements FactExtractionQueue {
  readonly mode = 'bullmq' as const;
  private readonly queue: Queue<FactExtractionJob>;
  private readonly fallbackQueue: InMemoryFactExtractionQueue;
  private processor?: FactExtractionProcessor;
  private worker: Worker<FactExtractionJob> | null = null;

  constructor(redisUrl: string) {
    this.queue = new Queue<FactExtractionJob>('fact-extraction', {
      connection: { url: redisUrl }
    });
    this.fallbackQueue = new InMemoryFactExtractionQueue();
  }

  registerProcessor(processor: FactExtractionProcessor) {
    this.processor = processor;
    this.fallbackQueue.registerProcessor(processor);
  }

  private ensureWorker() {
    if (!this.processor || this.worker) {
      return;
    }

    this.worker = new Worker<FactExtractionJob>(
      'fact-extraction',
      async (job) => {
        await this.processor?.(job.data);
      },
      {
        connection: { url: env.REDIS_URL }
      }
    );
  }

  async enqueue(job: FactExtractionJob) {
    try {
      const added = await this.queue.add(
        'extract',
        job,
        {
          jobId: `${job.sessionId}:fact-extract`,
          removeOnComplete: true,
          removeOnFail: false
        }
      );

      this.ensureWorker();

      return {
        queued: true,
        jobId: String(added.id)
      };
    } catch {
      return this.fallbackQueue.enqueue(job);
    }
  }

  async close() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}

export function createFactExtractionQueue(options?: { forceInMemory?: boolean }): FactExtractionQueue {
  if (!env.REDIS_URL || options?.forceInMemory) {
    return new InMemoryFactExtractionQueue();
  }

  return new BullFactExtractionQueue(env.REDIS_URL);
}
