import { afterEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance | null = null;

async function getApp() {
  if (!app) {
    app = buildApp();
  }
  return app;
}

async function injectJson(method: 'POST' | 'GET', url: string, payload?: unknown) {
  const current = await getApp();
  return current.inject({ method, url, payload });
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

describe('P0 API safety rails', () => {
  it('rejects malformed transcript ingest payloads with a non-2xx error (no silent failure)', async () => {
    const res = await injectJson('POST', '/api/v1/transcript-ingest', {
      sessionId: 'sess-1',
      segments: [
        {
          segmentId: 'seg-1',
          speaker: 'clinician',
          startMs: '0',
          endMs: 100,
          text: 'hello'
        }
      ]
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);

    const body = res.json();
    expect(body).toMatchObject({
      error: expect.any(String),
      message: expect.any(String),
      statusCode: expect.any(Number)
    });
  });

  it('enforces baseline writeback preconditions at the request-contract level', async () => {
    const res = await injectJson('POST', '/api/v1/writeback/jobs', {
      ehr: 'nextgen'
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);

    const body = res.json();
    expect(body).toMatchObject({
      error: expect.any(String),
      message: expect.any(String),
      statusCode: expect.any(Number)
    });
  });

  it('compose -> validation -> writeback happy path for medical notes', async () => {
    const composeRes = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-med-1',
      division: 'medical',
      noteFamily: 'progress_note'
    });
    expect(composeRes.statusCode).toBe(200);
    const composed = composeRes.json().data;

    const validateRes = await injectJson('POST', '/api/v1/validation-gate', {
      noteId: composed.noteId,
      unsupportedStatementRate: 0.02
    });
    expect(validateRes.statusCode).toBe(200);
    expect(validateRes.json().data.decision).toBe('approved_for_writeback');

    const writebackRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId: composed.noteId,
      ehr: 'nextgen',
      idempotencyKey: 'idem-med-1'
    });
    expect(writebackRes.statusCode).toBe(200);
    const job = writebackRes.json().data;
    expect(job.status).toBe('queued');
    expect(job.idempotencyKey).toBe('idem-med-1');

    const getJobRes = await injectJson('GET', `/api/v1/writeback/jobs/${job.jobId}`);
    expect(getJobRes.statusCode).toBe(200);
    expect(getJobRes.json().data.jobId).toBe(job.jobId);
  });

  it('applies BH strict defaults: zero unsupported still needs_review and cannot queue writeback', async () => {
    const composeRes = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-bh-1',
      division: 'bh',
      noteFamily: 'psych_note'
    });
    const noteId = composeRes.json().data.noteId;

    const validateRes = await injectJson('POST', '/api/v1/validation-gate', {
      noteId,
      unsupportedStatementRate: 0
    });
    expect(validateRes.statusCode).toBe(200);
    expect(validateRes.json().data.decision).toBe('needs_review');

    const writebackRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId,
      ehr: 'nextgen',
      idempotencyKey: 'idem-bh-1'
    });

    expect(writebackRes.statusCode).toBe(409);
    expect(writebackRes.json()).toMatchObject({
      ok: false,
      error: 'writeback_precondition_failed'
    });
  });

  it('rejects non-nextgen EHR target with explicit error', async () => {
    const composeRes = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-rehab-1',
      division: 'rehab',
      noteFamily: 'daily_note'
    });
    const noteId = composeRes.json().data.noteId;

    const validateRes = await injectJson('POST', '/api/v1/validation-gate', {
      noteId,
      unsupportedStatementRate: 0.01
    });
    expect(validateRes.json().data.decision).toBe('approved_for_writeback');

    const webptRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId,
      ehr: 'webpt',
      idempotencyKey: 'idem-webpt-1'
    });

    expect(webptRes.statusCode).toBe(400);
    expect(webptRes.json()).toMatchObject({
      ok: false,
      error: 'unsupported_ehr_target'
    });
  });

  it('enforces idempotent writeback job creation with idempotencyKey', async () => {
    const composeRes = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-med-idem-1',
      division: 'medical',
      noteFamily: 'progress_note'
    });
    const noteId = composeRes.json().data.noteId;

    await injectJson('POST', '/api/v1/validation-gate', {
      noteId,
      unsupportedStatementRate: 0
    });

    const payload = { noteId, ehr: 'nextgen', idempotencyKey: 'idem-shared-1' };
    const firstRes = await injectJson('POST', '/api/v1/writeback/jobs', payload);
    const secondRes = await injectJson('POST', '/api/v1/writeback/jobs', payload);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);

    const firstBody = firstRes.json();
    const secondBody = secondRes.json();

    expect(secondBody.idempotentReplay).toBe(true);
    expect(secondBody.data.jobId).toBe(firstBody.data.jobId);
    expect(secondBody.data.idempotencyKey).toBe(payload.idempotencyKey);
  });
});
