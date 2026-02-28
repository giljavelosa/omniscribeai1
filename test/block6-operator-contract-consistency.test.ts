import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEAD_LETTER_ERROR_CODE } from '../src/modules/operator-writeback/reasonCodes.js';

const TEST_API_KEY = 'block6-operator-contract-key';

describe('Block6 operator endpoint contract consistency', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('uses a stable success envelope and normalized reasonCode field across dead-letter surfaces', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block6-operator-envelope',
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
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-block6-operator-envelope' }
    });
    const jobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'target schema mismatch',
        lastErrorDetail: {
          code: ' validation_error ',
          patientName: 'Alice Doe'
        }
      }
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/dead-letters',
      headers
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      ok: true,
      data: [
        {
          jobId,
          reasonCode: 'VALIDATION_ERROR'
        }
      ]
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}`,
      headers
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      ok: true,
      data: {
        deadLetter: {
          jobId,
          reasonCode: 'VALIDATION_ERROR'
        }
      }
    });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/history`,
      headers
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      ok: true,
      data: {
        deadLetter: {
          jobId,
          reasonCode: 'VALIDATION_ERROR'
        },
        replayLinkage: {
          hasReplay: false
        }
      }
    });

    const replayStatus = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/replay-status`,
      headers
    });
    expect(replayStatus.statusCode).toBe(200);
    expect(replayStatus.json()).toMatchObject({
      ok: true,
      data: {
        deadLetter: {
          jobId,
          reasonCode: 'VALIDATION_ERROR'
        },
        replayLinkage: {
          originalJobId: jobId
        }
      }
    });

    await app.close();
  });

  it('uses DEAD_LETTER_ERROR_CODE constants with stable error envelope across operator dead-letter endpoints', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };
    const missingId = '00000000-0000-4000-8000-000000000777';

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: `/api/v1/operator/writeback/dead-letters/${missingId}`, headers }),
      app.inject({ method: 'GET', url: `/api/v1/operator/writeback/dead-letters/${missingId}/history`, headers }),
      app.inject({
        method: 'GET',
        url: `/api/v1/operator/writeback/dead-letters/${missingId}/replay-status`,
        headers
      }),
      app.inject({ method: 'POST', url: `/api/v1/operator/writeback/dead-letters/${missingId}/replay`, headers }),
      app.inject({
        method: 'POST',
        url: `/api/v1/operator/writeback/dead-letters/${missingId}/acknowledge`,
        headers
      })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        ok: false,
        error: {
          code: DEAD_LETTER_ERROR_CODE.NOT_FOUND,
          message: expect.any(String)
        },
        correlationId: expect.any(String)
      });
    }

    await app.close();
  });
});
