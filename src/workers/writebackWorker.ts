export const DEFAULT_MAX_WRITEBACK_ATTEMPTS = 3;

export type WritebackFailureTransition = 'retryable_failed' | 'dead_failed';

export function resolveFailedTransition(
  currentAttempts: number,
  maxAttempts = DEFAULT_MAX_WRITEBACK_ATTEMPTS
): { status: WritebackFailureTransition; nextAttempts: number } {
  const nextAttempts = currentAttempts + 1;
  if (nextAttempts >= maxAttempts) {
    return { status: 'dead_failed', nextAttempts };
  }

  return { status: 'retryable_failed', nextAttempts };
}

export interface WritebackWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

class NoopWritebackWorker implements WritebackWorker {
  async start() {
    return;
  }

  async stop() {
    return;
  }
}

export function createWritebackWorkerStub(): WritebackWorker {
  return new NoopWritebackWorker();
}
