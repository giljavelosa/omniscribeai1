import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'phase3-pr3-operator-key';

describe('Phase3 PR3 operator dead-letter parity', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('returns replayJobStatus in dead-letter history parity with replay-status', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase3-pr3-parity',
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
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-phase3-pr3-parity' }
    });

    const jobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'non-retryable failure',
        lastErrorDetail: { reasonCode: 'VALIDATION_ERROR' }
      }
    });

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/replay`,
      headers
    });

    expect(replay.statusCode).toBe(200);

    const replayStatus = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/replay-status`,
      headers
    });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/history`,
      headers
    });

    expect(replayStatus.statusCode).toBe(200);
    expect(history.statusCode).toBe(200);

    const replayJobStatus = replayStatus.json().data.replayLinkage.replayJobStatus;
    expect(replayJobStatus).toBeTypeOf('string');

    expect(history.json().data.replayLinkage).toMatchObject({
      originalJobId: jobId,
      hasReplay: true,
      replayJobStatus
    });

    await app.close();
  });
});
