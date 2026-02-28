import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const API_KEY = 'phase2-block2-qa-key';

describe('Phase2 Block2 QA: operator summary + timeline payloads', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('operator summary endpoint returns queue aggregates with stable envelope', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block2-summary',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId,
        unsupportedStatementRate: 0
      }
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-phase2-block2-summary'
      }
    });

    expect(create.statusCode).toBe(200);

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs?state=queued&limit=10',
      headers
    });

    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.json()).toMatchObject({
      ok: true,
      data: expect.any(Array)
    });
    expect(summaryRes.json().data.length).toBeGreaterThan(0);
    expect(summaryRes.json().data[0]).toMatchObject({
      jobId: expect.any(String),
      noteId: expect.any(String),
      status: 'queued',
      attempts: expect.any(Number)
    });

    await app.close();
  });

  it('operator job detail endpoint includes timeline payload in attemptHistory order', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-phase2-block2-timeline',
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
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-phase2-block2-timeline'
      }
    });
    const jobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'transient timeout',
        lastErrorDetail: { code: 'TIMEOUT' }
      }
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'queued'
      }
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'another timeout',
        lastErrorDetail: { code: 'TIMEOUT_AGAIN' }
      }
    });

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/writeback/jobs/${jobId}`,
      headers
    });

    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json()).toMatchObject({
      ok: true,
      data: {
        jobId,
        status: 'retryable_failed',
        attempts: 2,
        attemptHistory: expect.any(Array)
      }
    });

    const history = detailRes.json().data.attemptHistory;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      attempt: 1,
      fromStatus: 'queued',
      toStatus: 'retryable_failed',
      error: 'transient timeout',
      errorDetail: { code: 'TIMEOUT' }
    });
    expect(history[1]).toMatchObject({
      attempt: 2,
      fromStatus: 'queued',
      toStatus: 'retryable_failed',
      error: 'another timeout'
    });
    expect(history[1].errorDetail).toBeTruthy();
    expect(new Date(history[0].occurredAt).getTime()).toBeLessThanOrEqual(
      new Date(history[1].occurredAt).getTime()
    );

    await app.close();
  });

  it('unauthorized operator summary request returns 401 envelope', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs?state=queued'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: expect.any(String)
      }
    });

    await app.close();
  });

  it('unauthorized operator detail request returns 401 envelope', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs/non-existent-job'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: expect.any(String)
      }
    });

    await app.close();
  });
});
