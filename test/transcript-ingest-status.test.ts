import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('transcript ingest + session status', () => {
  it('upserts segments idempotently and exposes session status', async () => {
    const app = buildApp();

    const payload = {
      sessionId: 'sess-1',
      division: 'medical',
      segments: [
        {
          segmentId: 'seg-1',
          speaker: 'clinician',
          startMs: 0,
          endMs: 1000,
          text: 'hello'
        },
        {
          segmentId: 'seg-2',
          speaker: 'patient',
          startMs: 1000,
          endMs: 1800,
          text: 'hi'
        }
      ]
    };

    const res1 = await app.inject({ method: 'POST', url: '/api/v1/transcript-ingest', payload });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.ok).toBe(true);
    expect(body1.data.factExtractionJobId).toBe('sess-1:fact-extract');

    const res2 = await app.inject({ method: 'POST', url: '/api/v1/transcript-ingest', payload });
    expect(res2.statusCode).toBe(200);

    const statusRes = await app.inject({ method: 'GET', url: '/api/v1/sessions/sess-1/status' });
    expect(statusRes.statusCode).toBe(200);

    const statusBody = statusRes.json();
    expect(statusBody.ok).toBe(true);
    expect(statusBody.data.sessionId).toBe('sess-1');
    expect(statusBody.data.division).toBe('medical');
    expect(statusBody.data.status).toBe('fact_extraction_queued');
    expect(statusBody.data.segmentsIngested).toBe(2);
    expect(statusBody.data.factExtraction.queued).toBe(true);

    await app.close();
  });

  it('returns 404 for unknown session status', async () => {
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/missing/status' });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.data.sessionId).toBe('missing');

    await app.close();
  });
});
