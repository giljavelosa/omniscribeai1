import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'test-api-key';

describe('phase2 block1 practical slice', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('lists writeback jobs with operator filters (state, noteId, limit)', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const composeA = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block6-a',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteIdA = composeA.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId: noteIdA,
        unsupportedStatementRate: 0
      }
    });

    const createA = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId: noteIdA,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block6-a'
      }
    });
    const jobIdA = createA.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobIdA}/transition`,
      headers,
      payload: {
        status: 'in_progress'
      }
    });

    const composeB = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block6-b',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteIdB = composeB.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId: noteIdB,
        unsupportedStatementRate: 0
      }
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId: noteIdB,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block6-b'
      }
    });

    const listInProgress = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs?state=in_progress',
      headers
    });
    expect(listInProgress.statusCode).toBe(200);
    expect(listInProgress.json().data).toHaveLength(1);
    expect(listInProgress.json().data[0]).toMatchObject({
      jobId: jobIdA,
      noteId: noteIdA,
      status: 'in_progress'
    });

    const listByNote = await app.inject({
      method: 'GET',
      url: `/api/v1/writeback/jobs?noteId=${noteIdB}&limit=1`,
      headers
    });
    expect(listByNote.statusCode).toBe(200);
    expect(listByNote.json().data).toHaveLength(1);
    expect(listByNote.json().data[0]).toMatchObject({
      noteId: noteIdB,
      status: 'queued'
    });

    await app.close();
  });

  it('returns enhanced writeback failure details and validation reasons', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block6-details',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId as string;

    const validate = await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId,
        unsupportedStatementRate: 0.11
      }
    });

    expect(validate.statusCode).toBe(200);
    expect(validate.json().data.reasons).toEqual(['unsupported_rate_in_manual_review_band']);
    const persistedValidation = await app.repositories.validation.getLatestByNote(noteId);
    expect(persistedValidation?.reasons).toEqual(['unsupported_rate_in_manual_review_band']);

    const composeApproved = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block6-details-approved',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const approvedNoteId = composeApproved.json().data.noteId as string;

    await app.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId: approvedNoteId,
        unsupportedStatementRate: 0
      }
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId: approvedNoteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block6-details'
      }
    });
    const jobId = create.json().data.jobId as string;

    await app.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: {
        status: 'failed',
        lastError: 'timeout from upstream',
        lastErrorDetail: {
          code: 'TIMEOUT',
          endpoint: '/ehr/writeback',
          retryAfterMs: 5000
        }
      }
    });

    const details = await app.inject({
      method: 'GET',
      url: `/api/v1/writeback/jobs/${jobId}`,
      headers
    });

    expect(details.statusCode).toBe(200);
    expect(details.json().data).toMatchObject({
      status: 'retryable_failed',
      attempts: 1,
      lastError: 'timeout from upstream',
      lastErrorDetail: {
        code: 'TIMEOUT',
        endpoint: '/ehr/writeback'
      }
    });
    expect(details.json().data.attemptHistory).toHaveLength(1);
    expect(details.json().data.attemptHistory[0]).toMatchObject({
      attempt: 1,
      fromStatus: 'queued',
      toStatus: 'retryable_failed',
      error: 'timeout from upstream'
    });

    const auditEvents = await app.repositories.audit.listBySession('sess-block6-details-approved');
    const transitionEvent = auditEvents.find(
      (event) => event.eventType === 'writeback_transition_applied'
    );
    expect(transitionEvent).toBeTruthy();
    expect(transitionEvent?.payload).toMatchObject({
      jobId,
      fromStatus: 'queued',
      requestedStatus: 'failed',
      resolvedStatus: 'retryable_failed'
    });

    await app.close();
  });
});
