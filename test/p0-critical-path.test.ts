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

  it.todo('BH risk gate hard-stop: reject BH notes above configured risk threshold before writeback');

  it.todo('Writeback idempotency: duplicate idempotency key/precondition should not enqueue a second job');

  it.todo('Illegal state transition: reject attempts to move note from disallowed source state to target state');
});
