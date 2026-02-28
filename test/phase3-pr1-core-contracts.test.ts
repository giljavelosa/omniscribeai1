import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'test-api-key';

describe('phase3 pr1 core API contracts', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('keeps stable success envelopes across core pipeline endpoints', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const sessionId = 'sess-pr1-contract';

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/v1/transcript-ingest',
      headers,
      payload: {
        sessionId,
        division: 'medical',
        segments: [
          {
            segmentId: 'seg-1',
            speaker: 'clinician',
            startMs: 0,
            endMs: 1000,
            text: 'subjective report'
          }
        ]
      }
    });

    expect(ingest.statusCode).toBe(200);
    expect(ingest.json()).toMatchObject({
      ok: true,
      data: {
        sessionId,
        accepted: 1,
        division: 'medical',
        factExtractionJobId: `${sessionId}:fact-extract`
      }
    });

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId,
        division: 'medical',
        noteFamily: 'progress_note',
        useExistingFacts: true
      }
    });

    expect(compose.statusCode).toBe(200);
    const composeBody = compose.json();
    expect(composeBody).toMatchObject({
      ok: true,
      data: {
        noteId: expect.any(String),
        sessionId,
        division: 'medical',
        noteFamily: 'progress_note',
        metadata: {
          factCount: expect.any(Number),
          usedExistingFacts: true
        }
      }
    });

    const noteId = composeBody.data.noteId as string;

    const validate = await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId,
        unsupportedStatementRate: 0.02
      }
    });

    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toMatchObject({
      ok: true,
      data: {
        noteId,
        decision: 'approved_for_writeback',
        unsupportedStatementRate: 0.02,
        reasons: expect.any(Array)
      }
    });

    const writeback = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-pr1-contract-001'
      }
    });

    expect(writeback.statusCode).toBe(200);
    expect(writeback.json()).toMatchObject({
      ok: true,
      data: {
        jobId: expect.any(String),
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-pr1-contract-001',
        status: 'queued'
      }
    });

    await app.close();
  });

  it('keeps stable error envelope and representative domain error codes', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const ingestErr = await app.inject({
      method: 'POST',
      url: '/api/v1/transcript-ingest',
      headers,
      payload: {
        sessionId: 'sess-pr1-contract-error',
        division: 'medical',
        segments: []
      }
    });

    expect(ingestErr.statusCode).toBe(400);
    expect(ingestErr.json()).toMatchObject({
      ok: false,
      error: {
        code: 'TRANSCRIPT_SEGMENTS_REQUIRED',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
    });

    const noteComposeValidationErr = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-pr1-contract-error',
        division: 'medical',
        noteFamily: ''
      }
    });

    expect(noteComposeValidationErr.statusCode).toBe(400);
    expect(noteComposeValidationErr.json()).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
    });

    const validationMissingNote = await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId: 'missing-note-id',
        unsupportedStatementRate: 0.01
      }
    });

    expect(validationMissingNote.statusCode).toBe(404);
    expect(validationMissingNote.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOTE_NOT_FOUND',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
    });

    const writebackMissingNote = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId: '00000000-0000-0000-0000-000000000000',
        ehr: 'nextgen',
        idempotencyKey: 'idem-pr1-contract-missing-note'
      }
    });

    expect(writebackMissingNote.statusCode).toBe(404);
    expect(writebackMissingNote.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOTE_NOT_FOUND',
        message: expect.any(String)
      },
      correlationId: expect.any(String)
    });

    await app.close();
  });
});
