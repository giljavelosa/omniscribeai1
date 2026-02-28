import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const API_KEY = 'phase2-block3-sec-key';

describe('Phase2 Block3 security checks for dead-letter + replay surfaces', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('rejects malformed idempotency keys on writeback create to reduce replay abuse surface', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block3-idem-shape',
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

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: '../bad key with spaces'
      }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR'
      }
    });

    await app.close();
  });

  it('redacts sensitive details in operator dead-letter style job inspection payloads', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block3-redaction',
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
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-phase2-block3-redact' }
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
        lastError: 'upstream rejected payload',
        lastErrorDetail: {
          reasonCode: 'VALIDATION_ERROR',
          patientName: 'Alice Doe',
          authToken: 'secret-token-value'
        }
      }
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/jobs/${jobId}`,
      headers
    });

    expect(detail.statusCode).toBe(200);
    const attempt = detail.json().data.attempts[0];
    expect(attempt.reasonCode).toBe('VALIDATION_ERROR');
    expect(attempt.errorDetail.patientName).toBe('[REDACTED]');
    expect(attempt.errorDetail.authToken).toBe('[REDACTED]');

    await app.close();
  });

  it('rejects non-uuid job ids for writeback and operator job detail routes', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': API_KEY };

    const writeback = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs/not-a-uuid',
      headers
    });
    expect(writeback.statusCode).toBe(400);

    const operator = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/jobs/not-a-uuid',
      headers
    });
    expect(operator.statusCode).toBe(400);

    await app.close();
  });
});
