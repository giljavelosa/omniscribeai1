import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'phase2-block1-qa-key';

let app: FastifyInstance | null = null;

async function getApp() {
  if (!app) {
    app = buildApp();
  }

  return app;
}

const headers = { 'x-api-key': TEST_API_KEY };

async function createNote(current: FastifyInstance, sessionId: string, division: 'medical' | 'rehab' | 'bh') {
  const composeRes = await current.inject({
    method: 'POST',
    url: '/api/v1/note-compose',
    headers,
    payload: {
      sessionId,
      division,
      noteFamily: 'progress_note'
    }
  });

  expect(composeRes.statusCode).toBe(200);
  return composeRes.json().data.noteId as string;
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = TEST_API_KEY;
  delete process.env.REDIS_URL;
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  delete process.env.API_KEY;
});

describe('Phase2 Block1 QA: operator visibility + writeback assurance', () => {
  it('list endpoint filtering: state and noteId filters isolate operator-visible jobs', async () => {
    const current = await getApp();

    const noteA = await createNote(current, 'sess-phase2-list-a', 'medical');
    const noteB = await createNote(current, 'sess-phase2-list-b', 'medical');

    for (const noteId of [noteA, noteB]) {
      const validateRes = await current.inject({
        method: 'POST',
        url: '/api/v1/validation-gate',
        headers,
        payload: { noteId, unsupportedStatementRate: 0 }
      });
      expect(validateRes.statusCode).toBe(200);
    }

    const jobARes = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId: noteA, ehr: 'nextgen', idempotencyKey: 'idem-phase2-list-a' }
    });
    const jobBRes = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId: noteB, ehr: 'nextgen', idempotencyKey: 'idem-phase2-list-b' }
    });

    expect(jobARes.statusCode).toBe(200);
    expect(jobBRes.statusCode).toBe(200);

    const jobAId = jobARes.json().data.jobId as string;

    await current.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobAId}/transition`,
      headers,
      payload: { status: 'failed', lastError: 'transport timeout' }
    });

    const listByState = await current.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs?state=retryable_failed',
      headers
    });

    expect(listByState.statusCode).toBe(200);
    expect(listByState.json().data).toHaveLength(1);
    expect(listByState.json().data[0]).toMatchObject({ noteId: noteA, status: 'retryable_failed' });

    const listByNote = await current.inject({
      method: 'GET',
      url: `/api/v1/writeback/jobs?noteId=${noteB}`,
      headers
    });

    expect(listByNote.statusCode).toBe(200);
    expect(listByNote.json().data).toHaveLength(1);
    expect(listByNote.json().data[0]).toMatchObject({ noteId: noteB, status: 'queued' });
  });

  it('transition audit consistency: writeback transitions append ordered audit trail records', async () => {
    const current = await getApp();
    const sessionId = 'sess-phase2-audit-1';
    const noteId = await createNote(current, sessionId, 'medical');

    await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId, unsupportedStatementRate: 0 }
    });

    const createJob = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: { noteId, ehr: 'nextgen', idempotencyKey: 'idem-phase2-audit-1' }
    });

    const jobId = createJob.json().data.jobId as string;

    await current.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: { status: 'in_progress' }
    });

    await current.inject({
      method: 'POST',
      url: `/api/v1/writeback/jobs/${jobId}/transition`,
      headers,
      payload: { status: 'failed', lastError: 'remote 503' }
    });

    const events = await current.repositories.audit.listBySession(sessionId);
    const transitionEvents = events.filter((event) => event.eventType === 'writeback_transition_applied');

    expect(transitionEvents).toHaveLength(2);
    expect(transitionEvents[0].payload).toMatchObject({
      jobId,
      fromStatus: 'queued',
      requestedStatus: 'in_progress',
      resolvedStatus: 'in_progress'
    });
    expect(transitionEvents[1].payload).toMatchObject({
      jobId,
      fromStatus: 'in_progress',
      requestedStatus: 'failed',
      resolvedStatus: 'retryable_failed'
    });
  });

  it('validation reasons exist when decision is blocked or needs_review', async () => {
    const current = await getApp();

    const bhNoteId = await createNote(current, 'sess-phase2-reasons-bh', 'bh');
    const blockedNoteId = await createNote(current, 'sess-phase2-reasons-med', 'medical');

    const needsReviewRes = await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId: bhNoteId, unsupportedStatementRate: 0 }
    });

    const blockedRes = await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: { noteId: blockedNoteId, unsupportedStatementRate: 0.8 }
    });

    expect(needsReviewRes.statusCode).toBe(200);
    expect(blockedRes.statusCode).toBe(200);

    expect(needsReviewRes.json().data).toMatchObject({ decision: 'needs_review', reasons: expect.any(Array) });
    expect(needsReviewRes.json().data.reasons.length).toBeGreaterThan(0);

    expect(blockedRes.json().data).toMatchObject({ decision: 'blocked', reasons: expect.any(Array) });
    expect(blockedRes.json().data.reasons.length).toBeGreaterThan(0);
  });
});
