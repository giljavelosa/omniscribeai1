import { afterEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance | null = null;

async function injectJson(method: 'POST' | 'GET', url: string, payload?: unknown) {
  app = buildApp();
  return app.inject({ method, url, payload });
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

  it('returns needs_review for BH validation-gate requests (current behavior)', async () => {
    const res = await injectJson('POST', '/api/v1/validation-gate', {
      noteId: 'note-bh-1',
      division: 'bh'
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toEqual({
      ok: true,
      data: {
        noteId: 'note-bh-1',
        status: 'needs_review',
        unsupportedStatementRate: 0
      }
    });
  });

  it('documents BH hard-stop as expected-blocked: blocked status is not yet exposed by validation gate', async () => {
    const res = await injectJson('POST', '/api/v1/validation-gate', {
      noteId: 'note-bh-risk',
      division: 'bh'
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('needs_review');
    expect(body.data.status).not.toBe('blocked');
    expect(body.data).not.toHaveProperty('reasonCode');
  });

  it('captures current writeback gate behavior: nextgen and webpt are both accepted', async () => {
    const nextgenRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId: 'note-1',
      ehr: 'nextgen'
    });
    expect(nextgenRes.statusCode).toBe(200);
    expect(nextgenRes.json()).toEqual({
      ok: true,
      data: {
        noteId: 'note-1',
        ehr: 'nextgen',
        status: 'queued'
      }
    });

    const webptRes = await injectJson('POST', '/api/v1/writeback/jobs', {
      noteId: 'note-2',
      ehr: 'webpt'
    });
    expect(webptRes.statusCode).toBe(200);
    expect(webptRes.json()).toEqual({
      ok: true,
      data: {
        noteId: 'note-2',
        ehr: 'webpt',
        status: 'queued'
      }
    });
  });

  it('documents writeback idempotency as expected-blocked: duplicate requests lack dedupe contract', async () => {
    const payload = { noteId: 'note-idem-1', ehr: 'nextgen' as const };

    const firstRes = await injectJson('POST', '/api/v1/writeback/jobs', payload);
    const secondRes = await injectJson('POST', '/api/v1/writeback/jobs', payload);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);

    const firstBody = firstRes.json();
    const secondBody = secondRes.json();
    expect(firstBody).toEqual({
      ok: true,
      data: {
        noteId: 'note-idem-1',
        ehr: 'nextgen',
        status: 'queued'
      }
    });
    expect(secondBody).toEqual(firstBody);
    expect(firstBody.data).not.toHaveProperty('jobId');
    expect(firstBody.data).not.toHaveProperty('idempotencyKey');
  });

  it('documents invalid state transition coverage as expected-blocked: endpoint is currently missing', async () => {
    const res = await injectJson('POST', '/api/v1/state-transitions', {
      noteId: 'note-1',
      fromState: 'draft',
      toState: 'writeback_queued'
    });

    expect(res.statusCode).toBe(404);

    const body = res.json();
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found'
      },
      correlationId: expect.any(String)
    });
  });
});
