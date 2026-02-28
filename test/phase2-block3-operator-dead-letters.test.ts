import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'phase2-block3-dead-letters-key';

describe('Phase2 Block3 operator dead-letter APIs', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('lists dead-letters sorted by updatedAt desc with minimal operator fields and filters', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const composeA = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block3-list-a',
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

    const jobA = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId: noteA, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block3-list-a' }
    });
    const jobAId = jobA.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobAId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'network timeout',
        lastErrorDetail: {
          reasonCode: 'TIMEOUT',
          endpoint: '/ehr/writeback',
          accessToken: 'secret-token'
        }
      }
    });

    const composeB = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block3-list-b',
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

    const jobB = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId: noteB, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block3-list-b' }
    });
    const jobBId = jobB.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobBId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'schema mismatch',
        lastErrorDetail: {
          reasonCode: 'VALIDATION_ERROR',
          patientEmail: 'patient@example.com'
        }
      }
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/dead-letters',
      headers
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(2);
    expect(listed.json().data[0]).toMatchObject({
      jobId: jobBId,
      status: 'dead_failed',
      operatorStatus: 'open',
      reasonCode: 'VALIDATION_ERROR',
      attempts: 1,
      updatedAt: expect.any(String)
    });
    expect(listed.json().data[1]).toMatchObject({
      jobId: jobAId,
      status: 'retryable_failed',
      operatorStatus: 'open',
      reasonCode: 'TIMEOUT',
      attempts: 1,
      updatedAt: expect.any(String)
    });
    expect(listed.json().data[0].lastErrorDetail).toBeUndefined();
    expect(new Date(listed.json().data[0].updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(listed.json().data[1].updatedAt).getTime()
    );

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/dead-letters?status=retryable_failed&reason=timeout&limit=1',
      headers
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().data[0]).toMatchObject({
      jobId: jobAId,
      status: 'retryable_failed',
      operatorStatus: 'open',
      reasonCode: 'TIMEOUT',
      attempts: 1,
      updatedAt: expect.any(String)
    });

    await app.close();
  });

  it('blocks replay for non-dead_failed dead letters with explicit error code', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block4-replay-guard',
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
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block4-replay-guard' }
    });
    const originalJobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${originalJobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'transient timeout',
        lastErrorDetail: { reasonCode: 'TIMEOUT' }
      }
    });

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
      headers
    });

    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({
      ok: false,
      error: {
        code: 'DEAD_LETTER_REPLAY_REQUIRES_DEAD_FAILED'
      },
      correlationId: expect.any(String)
    });

    await app.close();
  });

  it('returns dead-letter detail and replay creates linked queued writeback job with new idempotency key', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block3-replay',
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
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block3-replay' }
    });
    const originalJobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${originalJobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'payload rejected',
        lastErrorDetail: {
          reasonCode: 'VALIDATION_ERROR',
          patientPhone: '555-555-5555'
        }
      }
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}`,
      headers
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      reasonCode: 'VALIDATION_ERROR',
      job: {
        jobId: originalJobId,
        status: 'dead_failed',
        lastErrorDetail: {
          reasonCode: 'VALIDATION_ERROR',
          patientPhone: '[REDACTED]'
        }
      }
    });

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
      headers
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      ok: true,
      data: {
        originalJob: {
          jobId: originalJobId,
          status: 'dead_failed',
          replayOfJobId: null,
          replayedJobId: expect.any(String)
        },
        replayJob: {
          jobId: expect.any(String),
          noteId,
          operatorStatus: 'open',
          status: 'queued',
          replayOfJobId: originalJobId,
          replayedJobId: null
        }
      }
    });

    const replayJobId = replay.json().data.replayJob.jobId as string;
    expect(replayJobId).not.toBe(originalJobId);
    expect(replay.json().data.originalJob.replayedJobId).toBe(replayJobId);
    expect(replay.json().data.replayJob.idempotencyKey).not.toBe('idem-phase2-block3-replay');

    const persistedOriginal = await app.repositories.writeback.getById(originalJobId);
    const persistedReplay = await app.repositories.writeback.getById(replayJobId);
    expect(persistedOriginal?.replayedJobId).toBe(replayJobId);
    expect(persistedReplay?.replayOfJobId).toBe(originalJobId);

    const replayAudit = (await app.repositories.audit.listByNote(noteId)).find(
      (event) => event.eventType === 'writeback_dead_letter_replayed'
    );
    expect(replayAudit?.payload).toMatchObject({
      originalJobId,
      replayJobId,
      reasonCode: 'VALIDATION_ERROR'
    });

    const replayAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
      headers
    });

    expect(replayAgain.statusCode).toBe(409);
    expect(replayAgain.json()).toMatchObject({
      ok: false,
      error: {
        code: 'WRITEBACK_REPLAY_ALREADY_EXISTS'
      }
    });

    await app.close();
  });

  it('acknowledges dead-letter jobs and summary reports open/acknowledged counts', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const composeA = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block4-ack-a',
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
      payload: { noteId: noteA, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block4-ack-a' }
    });
    const deadFailedJobId = createA.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${deadFailedJobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'payload rejected',
        lastErrorDetail: { reasonCode: 'VALIDATION_ERROR' }
      }
    });

    const composeB = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block4-ack-b',
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
      payload: { noteId: noteB, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block4-ack-b' }
    });
    const retryableJobId = createB.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${retryableJobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'temporary outage',
        lastErrorDetail: { reasonCode: 'TIMEOUT' }
      }
    });

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/status/summary?recentHours=24',
      headers
    });

    expect(before.statusCode).toBe(200);
    expect(before.json().data.deadLetterOperatorCounts).toMatchObject({
      open: 2,
      acknowledged: 0
    });

    const ack = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${deadFailedJobId}/acknowledge`,
      headers
    });

    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({
      ok: true,
      data: {
        jobId: deadFailedJobId,
        operatorStatus: 'acknowledged'
      }
    });

    const persisted = await app.repositories.writeback.getById(deadFailedJobId);
    expect(persisted?.operatorStatus).toBe('acknowledged');

    const secondAck = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${deadFailedJobId}/acknowledge`,
      headers
    });

    expect(secondAck.statusCode).toBe(409);
    expect(secondAck.json()).toMatchObject({
      ok: false,
      error: {
        code: 'DEAD_LETTER_ALREADY_ACKNOWLEDGED'
      },
      correlationId: expect.any(String)
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/status/summary?recentHours=24',
      headers
    });

    expect(after.statusCode).toBe(200);
    expect(after.json().data.deadLetterOperatorCounts).toMatchObject({
      open: 1,
      acknowledged: 1
    });

    await app.close();
  });
});
