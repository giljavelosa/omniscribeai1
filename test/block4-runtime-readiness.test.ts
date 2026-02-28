import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'test-api-key';

describe('block 4 runtime readiness', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('extracts facts on ingest fallback and composes with fact metadata', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/v1/transcript-ingest',
      headers,
      payload: {
        sessionId: 'sess-block4-facts',
        division: 'medical',
        segments: [
          {
            segmentId: 'seg-1',
            speaker: 'clinician',
            startMs: 0,
            endMs: 100,
            text: 'Patient reports headache'
          },
          {
            segmentId: 'seg-2',
            speaker: 'patient',
            startMs: 101,
            endMs: 250,
            text: 'No nausea'
          }
        ]
      }
    });

    expect(ingest.statusCode).toBe(200);

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block4-facts',
        division: 'medical',
        noteFamily: 'progress_note',
        useExistingFacts: true
      }
    });

    expect(compose.statusCode).toBe(200);
    const composed = compose.json().data;
    expect(composed.metadata.factCount).toBe(2);
    expect(composed.metadata.usedExistingFacts).toBe(true);
    expect(composed.body).toContain('Fact Signals');

    await app.close();
  });

  it('maps failed transition to retryable_failed with attempts update', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block4-wb',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId,
        unsupportedStatementRate: 0
      }
    });

    const writeback = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block4-wb'
      }
    });

    const jobId = writeback.json().data.jobId;

    const failedTransition = await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'temporary endpoint outage'
      }
    });

    expect(failedTransition.statusCode).toBe(200);
    expect(failedTransition.json().data.status).toBe('retryable_failed');
    expect(failedTransition.json().data.attempts).toBe(1);

    const retryTransition = await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'queued'
      }
    });

    expect(retryTransition.statusCode).toBe(200);
    expect(retryTransition.json().data.status).toBe('queued');

    await app.close();
  });
});
