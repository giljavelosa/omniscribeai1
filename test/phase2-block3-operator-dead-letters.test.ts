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

  it('lists dead-letters with status/reason/limit filters and redacts sensitive error details', async () => {
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
      reasonCode: 'TIMEOUT',
      lastErrorDetail: {
        reasonCode: 'TIMEOUT',
        accessToken: '[REDACTED]'
      }
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

    await app.close();
  });
});
