export const DEFAULT_MAX_WRITEBACK_ATTEMPTS = 3;

export type WritebackFailureTransition = 'retryable_failed' | 'dead_failed';
export type WritebackFailureClassification = 'retryable' | 'non_retryable' | 'unknown';

const RETRYABLE_REASON_CODES = new Set([
  'TIMEOUT',
  'UPSTREAM_TIMEOUT',
  'RATE_LIMITED',
  'TEMP_UNAVAILABLE',
  'NETWORK_ERROR'
]);

const NON_RETRYABLE_REASON_CODES = new Set([
  'VALIDATION_ERROR',
  'SCHEMA_MISMATCH',
  'UNSUPPORTED_EHR_TARGET',
  'PERMISSION_DENIED',
  'AUTH_INVALID',
  'PATIENT_NOT_FOUND',
  'NOTE_REJECTED'
]);

export function classifyWritebackFailureReason(
  reasonCode?: string | null
): WritebackFailureClassification {
  const normalized = reasonCode?.trim().toUpperCase();
  if (!normalized) {
    return 'unknown';
  }

  if (NON_RETRYABLE_REASON_CODES.has(normalized)) {
    return 'non_retryable';
  }

  if (RETRYABLE_REASON_CODES.has(normalized)) {
    return 'retryable';
  }

  return 'unknown';
}

export function resolveFailedTransition(
  currentAttempts: number,
  maxAttempts = DEFAULT_MAX_WRITEBACK_ATTEMPTS,
  reasonCode?: string | null
): { status: WritebackFailureTransition; nextAttempts: number } {
  const nextAttempts = currentAttempts + 1;
  const classification = classifyWritebackFailureReason(reasonCode);
  if (classification === 'non_retryable') {
    return { status: 'dead_failed', nextAttempts };
  }

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
