import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance | null = null;
const TEST_API_KEY = 'test-api-key';

async function getApp() {
  if (!app) {
    app = buildApp();
  }
  return app;
}

async function injectJson(
  method: 'POST' | 'GET',
  url: string,
  payload?: unknown,
  withAuth = true
) {
  const current = await getApp();
  const headers =
    method === 'POST' && withAuth
      ? {
          'x-api-key': TEST_API_KEY
        }
      : undefined;

  return current.inject({ method, url, payload, headers });
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = TEST_API_KEY;
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  delete process.env.API_KEY;
});

describe('P0 API safety rails', () => {
  it('rejects malformed transcript ingest payloads with a 400 validation envelope', async () => {
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

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
    });
  });

  it('enforces API key auth on mutation endpoints', async () => {
    const res = await injectJson(
      'POST',
      '/api/v1/transcript-ingest',
      {
        sessionId: 'sess-unauth',
        division: 'medical',
        segments: []
      },
      false
    );

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('enforces baseline writeback preconditions at the request-contract level', async () => {
    const res = await injectJson('POST', '/api/v1/writeback/jobs', {
      ehr: 'nextgen'
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
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
      error: {
        code: 'WRITEBACK_PRECONDITION_FAILED'
      }
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
      error: {
        code: 'UNSUPPORTED_EHR_TARGET'
      }
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


  it('requires API key on fact-ledger extraction endpoint', async () => {
    const res = await injectJson(
      'POST',
      '/api/v1/fact-ledger/extract',
      {
        sessionId: 'sess-facts-unauth'
      },
      false
    );

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED'
      }
    });
  });

  it('rejects blank noteFamily to keep compose contract deterministic', async () => {
    const res = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-notefamily-blank',
      division: 'medical',
      noteFamily: '   '
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR'
      }
    });
  });

  it('requires lastError only for failed writeback transitions', async () => {
    const composeRes = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-transition-contract-1',
      division: 'medical',
      noteFamily: 'progress_note'
    });
    const noteId = composeRes.json().data.noteId;

    await injectJson('POST', '/api/v1/validation-gate', {
      noteId,
      unsupportedStatementRate: 0
    });

    const writebackRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId,
      ehr: 'nextgen',
      idempotencyKey: 'idem-transition-contract-1'
    });

    const jobId = writebackRes.json().data.jobId;

    const missingLastError = await injectJson('POST', '/api/v1/writeback/jobs/' + jobId + '/transition', {
      status: 'failed'
    });

    expect(missingLastError.statusCode).toBe(400);
    expect(missingLastError.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR'
      }
    });

    const illegalLastError = await injectJson('POST', '/api/v1/writeback/jobs/' + jobId + '/transition', {
      status: 'in_progress',
      lastError: 'should-not-be-present'
    });

    expect(illegalLastError.statusCode).toBe(400);
    expect(illegalLastError.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR'
      }
    });
  });

  it('rejects illegal writeback status transitions with explicit error code', async () => {
    const composeRes = await injectJson('POST', '/api/v1/note-compose', {
      sessionId: 'sess-transition-1',
      division: 'medical',
      noteFamily: 'progress_note'
    });
    const noteId = composeRes.json().data.noteId;

    await injectJson('POST', '/api/v1/validation-gate', {
      noteId,
      unsupportedStatementRate: 0
    });

    const writebackRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId,
      ehr: 'nextgen',
      idempotencyKey: 'idem-transition-1'
    });
    const jobId = writebackRes.json().data.jobId;

    const illegalTransitionRes = await injectJson('POST', `/api/v1/writeback/jobs/${jobId}/transition`, {
      status: 'queued'
    });

    expect(illegalTransitionRes.statusCode).toBe(409);
    expect(illegalTransitionRes.json()).toMatchObject({
      ok: false,
      error: {
        code: 'ILLEGAL_WRITEBACK_STATE_TRANSITION'
      }
    });
  });
});
