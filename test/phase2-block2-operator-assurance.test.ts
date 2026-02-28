import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'phase2-block2-operator-key';

describe('Phase2 Block2 operator assurance APIs', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('returns operator summary with counts by status and recent failure classification', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const composeA = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block2-summary-a',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteA = composeA.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId: noteA, unsupportedStatementRate: 0 }
    });

    const createA = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId: noteA, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block2-summary-a' }
    });
    const jobAId = createA.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobAId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'upstream timeout',
        lastErrorDetail: { code: 'TIMEOUT' }
      }
    });

    const composeB = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block2-summary-b',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteB = composeB.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId: noteB, unsupportedStatementRate: 0 }
    });

    const createB = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId: noteB, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block2-summary-b' }
    });
    const jobBId = createB.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobBId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'payload rejected by target',
        lastErrorDetail: { reasonCode: 'VALIDATION_ERROR' }
      }
    });

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/status/summary?recentHours=24',
      headers
    });

    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      ok: true,
      data: {
        countsByStatus: {
          retryable_failed: 1,
          dead_failed: 1
        },
        recentFailures: {
          total: 2,
          retryable: 1,
          nonRetryable: 1,
          unknown: 0,
          byReasonCode: {
            TIMEOUT: 1,
            VALIDATION_ERROR: 1
          },
          windowHours: 24
        }
      }
    });

    await app.close();
  });

  it('returns operator job detail with timeline audit events and attempt details', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block2-detail',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId, unsupportedStatementRate: 0 }
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block2-detail' }
    });
    const jobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: { status: 'in_progress' }
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'network flake',
        lastErrorDetail: { code: 'NETWORK_ERROR' }
      }
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/jobs/${jobId}`,
      headers
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.job).toMatchObject({
      jobId,
      noteId,
      status: 'retryable_failed',
      attempts: 1
    });
    expect(detail.json().data.attempts).toHaveLength(1);
    expect(detail.json().data.attempts[0]).toMatchObject({
      attempt: 1,
      fromStatus: 'in_progress',
      toStatus: 'retryable_failed',
      reasonCode: 'NETWORK_ERROR'
    });
    expect(detail.json().data.timeline).toHaveLength(3);
    expect(detail.json().data.timeline.map((event: { eventType: string }) => event.eventType)).toEqual([
      'writeback_job_queued',
      'writeback_transition_applied',
      'writeback_transition_applied'
    ]);

    await app.close();
  });
});
