import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEAD_LETTER_ERROR_CODE } from '../src/modules/operator-writeback/reasonCodes.js';

const TEST_API_KEY = 'phase2-block5-writeback-key';

async function createDeadLetterJob(
  app: ReturnType<typeof buildApp>,
  headers: Record<string, string>,
  input: {
    sessionId: string;
    idempotencyKey: string;
    lastError: string;
    reasonCode: 'TIMEOUT' | 'VALIDATION_ERROR';
  }
) {
  const compose = await app.inject({
    method: 'POST',
    url: '/api/v1/note-compose',
    headers,
    payload: {
      sessionId: input.sessionId,
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
    payload: { noteId, ehr: 'nextgen', idempotencyKey: input.idempotencyKey }
  });
  const jobId = create.json().data.jobId as string;

  await app.inject({
    method: 'POST',
    url: `/api/v1/writeback/jobs/${jobId}/transition`,
    headers,
    payload: {
      status: 'failed',
      lastError: input.lastError,
      lastErrorDetail: {
        reasonCode: input.reasonCode,
        patientEmail: 'patient@example.com'
      }
    }
  });

  return { noteId, jobId };
}

describe('Phase2 Block5 writeback replay guard + history endpoint', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('prevents duplicate replay linkage under concurrent replay attempts', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };
    const { noteId, jobId } = await createDeadLetterJob(app, headers, {
      sessionId: 'sess-phase2-block5-race',
      idempotencyKey: 'idem-phase2-block5-race',
      lastError: 'payload rejected',
      reasonCode: 'VALIDATION_ERROR'
    });

    const replayPath = `/api/v1/operator/writeback/dead-letters/${jobId}/replay`;
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: replayPath, headers }),
      app.inject({ method: 'POST', url: replayPath, headers })
    ]);

    const codes = [a.statusCode, b.statusCode].sort((left, right) => left - right);
    expect(codes).toEqual([200, 409]);

    const success = a.statusCode === 200 ? a : b;
    const conflict = a.statusCode === 409 ? a : b;
    expect(conflict.json().error.code).toBe(DEAD_LETTER_ERROR_CODE.REPLAY_ALREADY_EXISTS);

    const replayJobId = success.json().data.replayJob.jobId as string;
    const original = await app.repositories.writeback.getById(jobId);
    expect(original?.replayedJobId).toBe(replayJobId);

    const jobs = await app.repositories.writeback.list({ noteId, limit: 10 });
    const replayJobs = jobs.filter((job) => job.replayOfJobId === jobId);
    expect(replayJobs).toHaveLength(1);
    expect(replayJobs[0].jobId).toBe(replayJobId);

    await app.close();
  });

  it('returns dead-letter history with replay linkage summary and timeline', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };
    const { jobId } = await createDeadLetterJob(app, headers, {
      sessionId: 'sess-phase2-block5-history',
      idempotencyKey: 'idem-phase2-block5-history',
      lastError: 'payload rejected',
      reasonCode: 'VALIDATION_ERROR'
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/replay`,
      headers
    });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/operator/writeback/dead-letters/${jobId}/history`,
      headers
    });

    expect(history.statusCode).toBe(200);
    expect(history.json().data).toMatchObject({
      deadLetter: {
        jobId,
        reasonCode: 'VALIDATION_ERROR'
      },
      replayLinkage: {
        hasReplay: true,
        replayedJobId: expect.any(String),
        isReplay: false
      }
    });
    expect(history.json().data.deadLetter.idempotencyKey).toBeUndefined();
    expect(history.json().data.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'writeback_dead_letter_replayed', actor: 'operator' })
      ])
    );

    await app.close();
  });

  it('uses dead-letter replay/acknowledge reason codes consistently', async () => {
    const app = buildApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const retryable = await createDeadLetterJob(app, headers, {
      sessionId: 'sess-phase2-block5-reason-retryable',
      idempotencyKey: 'idem-phase2-block5-reason-retryable',
      lastError: 'temporary timeout',
      reasonCode: 'TIMEOUT'
    });
    const replayRetryable = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${retryable.jobId}/replay`,
      headers
    });
    expect(replayRetryable.statusCode).toBe(409);
    expect(replayRetryable.json().error.code).toBe(DEAD_LETTER_ERROR_CODE.REPLAY_REQUIRES_DEAD_FAILED);

    const deadFailed = await createDeadLetterJob(app, headers, {
      sessionId: 'sess-phase2-block5-reason-dead',
      idempotencyKey: 'idem-phase2-block5-reason-dead',
      lastError: 'payload rejected',
      reasonCode: 'VALIDATION_ERROR'
    });
    const firstReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${deadFailed.jobId}/replay`,
      headers
    });
    expect(firstReplay.statusCode).toBe(200);

    const replayAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${deadFailed.jobId}/replay`,
      headers
    });
    expect(replayAgain.statusCode).toBe(409);
    expect(replayAgain.json().error.code).toBe(DEAD_LETTER_ERROR_CODE.REPLAY_ALREADY_EXISTS);

    const firstAck = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${deadFailed.jobId}/acknowledge`,
      headers
    });
    expect(firstAck.statusCode).toBe(200);

    const secondAck = await app.inject({
      method: 'POST',
      url: `/api/v1/operator/writeback/dead-letters/${deadFailed.jobId}/acknowledge`,
      headers
    });
    expect(secondAck.statusCode).toBe(409);
    expect(secondAck.json().error.code).toBe(DEAD_LETTER_ERROR_CODE.ALREADY_ACKNOWLEDGED);

    await app.close();
  });
});
