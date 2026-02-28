import { Queue } from 'bullmq';
import type { Division } from '../repositories/contracts.js';
import { env } from '../config/env.js';

export type FactExtractionJob = {
  sessionId: string;
  division: Division;
};

export interface FactExtractionQueue {
  enqueue(job: FactExtractionJob): Promise<{ queued: boolean; jobId: string }>;
  close(): Promise<void>;
}

class InMemoryFactExtractionQueue implements FactExtractionQueue {
  async enqueue(job: FactExtractionJob) {
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
  private readonly queue: Queue<FactExtractionJob>;

  constructor(redisUrl: string) {
    this.queue = new Queue<FactExtractionJob>('fact-extraction', {
      connection: { url: redisUrl }
    });
  }

  async enqueue(job: FactExtractionJob) {
    const added = await this.queue.add(
      'extract',
      job,
      {
        jobId: `${job.sessionId}:fact-extract`,
        removeOnComplete: true,
        removeOnFail: false
      }
    );

    return {
      queued: true,
      jobId: String(added.id)
    };
  }

  async close() {
    await this.queue.close();
  }
}

export function createFactExtractionQueue(): FactExtractionQueue {
  if (!env.REDIS_URL) {
    return new InMemoryFactExtractionQueue();
  }

  return new BullFactExtractionQueue(env.REDIS_URL);
}
