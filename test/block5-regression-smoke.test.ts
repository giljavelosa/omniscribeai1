import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'block5-smoke-key';

let app: FastifyInstance | null = null;

async function getApp() {
  if (!app) {
    app = buildApp();
  }

  return app;
}

async function runSmokeFlow(current: FastifyInstance, apiKey: string): Promise<'PASS' | `FAIL: ${string}`> {
  const headers = { 'x-api-key': apiKey };

  const ingestRes = await current.inject({
    method: 'POST',
    url: '/api/v1/transcript-ingest',
    headers,
    payload: {
      sessionId: 'sess-block5-smoke',
      division: 'medical',
      segments: [
        {
          segmentId: 'seg-1',
          speaker: 'clinician',
          startMs: 0,
          endMs: 1000,
          text: 'Patient reports good response to treatment.'
        }
      ]
    }
  });
  if (ingestRes.statusCode !== 200) {
    return `FAIL: ingest status=${ingestRes.statusCode}`;
  }

  const composeRes = await current.inject({
    method: 'POST',
    url: '/api/v1/note-compose',
    headers,
    payload: {
      sessionId: 'sess-block5-smoke',
      division: 'medical',
      noteFamily: 'progress_note'
    }
  });
  if (composeRes.statusCode !== 200) {
    return `FAIL: compose status=${composeRes.statusCode}`;
  }
  const noteId = composeRes.json().data.noteId as string;

  const validateRes = await current.inject({
    method: 'POST',
    url: '/api/v1/validation-gate',
    headers,
    payload: {
      noteId,
      unsupportedStatementRate: 0
    }
  });
  if (validateRes.statusCode !== 200 || validateRes.json().data.decision !== 'approved_for_writeback') {
    return `FAIL: validate status=${validateRes.statusCode}`;
  }

  const writebackRes = await current.inject({
    method: 'POST',
    url: '/api/v1/writeback/jobs',
    headers,
    payload: {
      noteId,
      ehr: 'nextgen',
      idempotencyKey: 'idem-block5-smoke'
    }
  });
  if (writebackRes.statusCode !== 200) {
    return `FAIL: writeback status=${writebackRes.statusCode}`;
  }

  const jobId = writebackRes.json().data.jobId as string;
  const statusRes = await current.inject({
    method: 'GET',
    url: `/api/v1/writeback/jobs/${jobId}`,
    headers
  });
  if (statusRes.statusCode !== 200) {
    return `FAIL: status status=${statusRes.statusCode}`;
  }

  return 'PASS';
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.API_KEY;
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }

  delete process.env.API_KEY;
});

describe('Block5 regressions: compose->validate->writeback and smoke contract', () => {
  it('prevents duplicate writeback job creation when note already moved out of approved_for_writeback', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await current.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block5-dup-1',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId;

    const validate = await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId,
        unsupportedStatementRate: 0
      }
    });
    expect(validate.statusCode).toBe(200);

    const firstWriteback = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block5-dup-a'
      }
    });
    expect(firstWriteback.statusCode).toBe(200);

    const secondWriteback = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block5-dup-b'
      }
    });

    expect(secondWriteback.statusCode).toBe(409);
    expect(secondWriteback.json()).toMatchObject({
      ok: false,
      error: {
        code: 'WRITEBACK_PRECONDITION_FAILED'
      }
    });
  });

  it('transition endpoint returns 404 with stable envelope for unknown job ids', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    const res = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs/00000000-0000-4000-8000-000000000999/transition',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { status: 'failed', lastError: 'transport timeout' }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'WRITEBACK_JOB_NOT_FOUND'
      },
      correlationId: expect.any(String)
    });
  });

  it('smoke flow returns PASS with valid x-api-key when API_KEY is set', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    const result = await runSmokeFlow(current, TEST_API_KEY);
    expect(result).toBe('PASS');
  });

  it('smoke flow returns FAIL contract when API_KEY is set incorrectly', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    const result = await runSmokeFlow(current, 'wrong-key');
    expect(result).toContain('FAIL:');
  });

  it('enforces replay race/idempotency guard and keeps dead-letter reason code normalization consistent', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await current.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block5-replay-race',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId as string;

    await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId, unsupportedStatementRate: 0 }
    });

    const create = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block5-replay-race'
      }
    });
    const originalJobId = create.json().data.jobId as string;

    await current.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${originalJobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'upstream rejected payload',
        lastErrorDetail: {
          code: ' validation_error ',
          patientEmail: 'patient@example.com'
        }
      }
    });

    const listed = await current.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/dead-letters?status=dead_failed&reason=validation_error',
      headers
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      ok: true,
      data: [
        {
          jobId: originalJobId,
          reasonCode: 'VALIDATION_ERROR',
          status: 'dead_failed'
        }
      ]
    });

    const detail = await current.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}`,
      headers
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      reasonCode: 'VALIDATION_ERROR',
      attempts: [
        {
          attempt: 1,
          reasonCode: 'VALIDATION_ERROR'
        }
      ]
    });

    const [replayA, replayB] = await Promise.all([
      current.inject({
        method: 'POST',
        url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
        headers
      }),
      current.inject({
        method: 'POST',
        url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
        headers
      })
    ]);

    const responses = [replayA, replayB];
    const successful = responses.find((res) => res.statusCode === 200);
    expect(successful).toBeTruthy();
    expect(responses.every((res) => res.statusCode === 200 || res.statusCode === 409)).toBe(true);

    expect(successful?.json()).toMatchObject({
      ok: true,
      data: {
        originalJob: {
          jobId: originalJobId,
          replayedJobId: expect.any(String)
        },
        replayJob: {
          jobId: expect.any(String),
          replayOfJobId: originalJobId
        }
      }
    });

    const replayAfterRace = await current.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
      headers
    });
    expect(replayAfterRace.statusCode).toBe(409);
    expect(replayAfterRace.json()).toMatchObject({
      ok: false,
      error: {
        code: 'WRITEBACK_REPLAY_ALREADY_EXISTS'
      },
      correlationId: expect.any(String)
    });

    const replayJobs = await current.repositories.writeback.list({
      noteId,
      limit: 20
    });
    const linkedReplays = replayJobs.filter((job) => job.replayOfJobId === originalJobId);
    expect(linkedReplays.length).toBeGreaterThan(0);
  });

  it('dead-letter history endpoint enforces auth and returns stable 401 envelope', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    const unauthorized = await current.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/dead-letters/00000000-0000-4000-8000-000000000111'
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
    });
  });

  it('dead-letter history endpoint returns expected envelope and payload shape', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await current.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block5-history-shape',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId as string;

    await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId, unsupportedStatementRate: 0 }
    });

    const create = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block5-history-shape'
      }
    });
    const originalJobId = create.json().data.jobId as string;

    await current.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${originalJobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'target schema mismatch',
        lastErrorDetail: {
          reasonCode: 'validation_error',
          patientName: 'Alice Doe'
        }
      }
    });

    await current.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}/replay`,
      headers
    });

    const detail = await current.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${originalJobId}`,
      headers
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      ok: true,
      data: {
        reasonCode: 'VALIDATION_ERROR',
        job: {
          jobId: originalJobId,
          noteId,
          status: 'dead_failed',
          replayedJobId: expect.any(String)
        },
        attempts: [
          {
            attempt: 1,
            reasonCode: 'VALIDATION_ERROR'
          }
        ],
        timeline: expect.any(Array)
      }
    });

    const body = detail.json().data;
    expect(body.attempts[0].errorDetail.patientName).toBe('[REDACTED]');
    expect(body.timeline.length).toBeGreaterThan(0);
    expect(body.timeline.some((event: { eventType: string }) => event.eventType === 'writeback_job_queued')).toBe(
      true
    );
    expect(
      body.timeline.some((event: { eventType: string }) => event.eventType === 'writeback_transition_applied')
    ).toBe(true);
    expect(
      body.timeline.some((event: { eventType: string }) => event.eventType === 'writeback_dead_letter_replayed')
    ).toBe(true);
  });
});
