import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../../lib/apiError.js';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';
import { redactSensitive } from '../../lib/redaction.js';
import { readWritebackReasonCode } from '../../lib/writebackReasonCode.js';
import type { WritebackJob } from '../../repositories/contracts.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';
import { DEAD_LETTER_ERROR_CODE } from './reasonCodes.js';

const summaryQuerySchema = z.object({
  recentHours: z.coerce.number().int().min(1).max(168).default(24)
});

const deadLetterListQuerySchema = z.object({
  status: z.enum(['retryable_failed', 'dead_failed', 'failed']).optional(),
  reason: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

function isDeadLetterStatus(status: string): boolean {
  return status === 'retryable_failed' || status === 'dead_failed' || status === 'failed';
}

function sanitize<T>(payload: T): T {
  return redactSensitive(JSON.parse(JSON.stringify(payload)) as T);
}

function toDeadLetterSummary(job: {
  jobId: string;
  noteId: string;
  status: string;
  operatorStatus: 'open' | 'acknowledged';
  lastErrorDetail: Record<string, unknown> | null;
  attempts: number;
  replayOfJobId: string | null;
  replayedJobId: string | null;
  updatedAt: string;
}) {
  return {
    jobId: job.jobId,
    noteId: job.noteId,
    status: job.status,
    operatorStatus: job.operatorStatus,
    reasonCode: readWritebackReasonCode(job.lastErrorDetail),
    attempts: job.attempts,
    replayOfJobId: job.replayOfJobId,
    replayedJobId: job.replayedJobId,
    updatedAt: job.updatedAt
  };
}

function toDeadLetterAttempt(attempt: {
  attempt: number;
  fromStatus: string;
  toStatus: string;
  error: string;
  errorDetail: Record<string, unknown> | null;
  occurredAt: string;
}) {
  return {
    attempt: attempt.attempt,
    fromStatus: attempt.fromStatus,
    toStatus: attempt.toStatus,
    error: attempt.error,
    reasonCode: readWritebackReasonCode(attempt.errorDetail),
    occurredAt: attempt.occurredAt
  };
}

function toOperatorJob(job: WritebackJob) {
  return {
    jobId: job.jobId,
    noteId: job.noteId,
    ehr: job.ehr,
    status: job.status,
    attempts: job.attempts,
    operatorStatus: job.operatorStatus,
    lastError: job.lastError,
    reasonCode: readWritebackReasonCode(job.lastErrorDetail),
    replayOfJobId: job.replayOfJobId,
    replayedJobId: job.replayedJobId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function toReplayLinkageStatus(
  deadLetter: WritebackJob,
  replayJob: WritebackJob | null
): {
  originalJobId: string;
  isReplay: boolean;
  hasReplay: boolean;
  replayOfJobId: string | null;
  replayedJobId: string | null;
  replayJobStatus: string | null;
} {
  return {
    originalJobId: deadLetter.jobId,
    isReplay: Boolean(deadLetter.replayOfJobId),
    hasReplay: Boolean(deadLetter.replayedJobId),
    replayOfJobId: deadLetter.replayOfJobId,
    replayedJobId: deadLetter.replayedJobId,
    replayJobStatus: replayJob?.status ?? null
  };
}

function toTimelineEntry(event: {
  eventId: string;
  eventType: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    actor: event.actor,
    payload: event.payload,
    createdAt: event.createdAt
  };
}

function readEventJobIds(payload: Record<string, unknown>): string[] {
  const candidateKeys = ['jobId', 'originalJobId', 'replayJobId'];
  const ids: string[] = [];
  for (const key of candidateKeys) {
    const value = payload[key];
    if (typeof value === 'string') {
      ids.push(value);
    }
  }
  return ids;
}

const TIMELINE_MAX_EVENTS = 100;

function sanitizeTimeline(timeline: Array<Record<string, unknown>>) {
  return sanitize(
    timeline.slice(-TIMELINE_MAX_EVENTS).map((event) =>
      toTimelineEntry({
        eventId: String(event.eventId),
        eventType: String(event.eventType),
        actor: String(event.actor),
        payload: (event.payload ?? {}) as Record<string, unknown>,
        createdAt: String(event.createdAt)
      })
    )
  );
}

const jobIdParamSchema = z.object({
  jobId: z.string().uuid()
});

export const operatorWritebackRoutes: FastifyPluginAsync = async (app) => {
  app.get('/operator/writeback/status/summary', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = summaryQuerySchema.parse(req.query ?? {});
    const since = new Date(Date.now() - parsed.recentHours * 60 * 60 * 1000).toISOString();
    const summary = await app.repositories.writeback.getStatusSummary(since);

    return reply.send({
      ok: true,
      data: {
        countsByStatus: summary.countsByStatus,
        deadLetterOperatorCounts: summary.deadLetterOperatorCounts,
        recentFailures: {
          ...summary.recentFailures,
          windowHours: parsed.recentHours
        }
      }
    });
  });

  app.get('/operator/writeback/dead-letters', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = deadLetterListQuerySchema.parse(req.query ?? {});
    const jobs = await app.repositories.writeback.listDeadLetters({
      status: parsed.status,
      reason: parsed.reason,
      limit: parsed.limit
    });

    return reply.send({
      ok: true,
      data: sanitize(jobs.map((job) => toDeadLetterSummary(job)))
    });
  });

  app.get('/operator/writeback/dead-letters/:id', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
    const job = await app.repositories.writeback.getById(jobId);

    if (!job || !isDeadLetterStatus(job.status)) {
      return sendApiError(
        req,
        reply,
        404,
        DEAD_LETTER_ERROR_CODE.NOT_FOUND,
        `dead-letter not found: ${jobId}`
      );
    }

    return reply.send({
      ok: true,
      data: sanitize({
        deadLetter: toDeadLetterSummary(job),
        lastError: job.lastError,
        attempts: job.attemptHistory.map((attempt) => toDeadLetterAttempt(attempt)),
        replayLinkage: {
          replayOfJobId: job.replayOfJobId,
          replayedJobId: job.replayedJobId
        }
      })
    });
  });

  app.get('/operator/writeback/dead-letters/:id/history', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
    const job = await app.repositories.writeback.getById(jobId);

    if (!job || !isDeadLetterStatus(job.status)) {
      return sendApiError(
        req,
        reply,
        404,
        DEAD_LETTER_ERROR_CODE.NOT_FOUND,
        `dead-letter not found: ${jobId}`
      );
    }

    const relatedJobIds = new Set(
      [job.jobId, job.replayOfJobId, job.replayedJobId].filter((value): value is string => Boolean(value))
    );
    const replayJob = job.replayedJobId
      ? await app.repositories.writeback.getById(job.replayedJobId)
      : null;

    const timeline = sanitizeTimeline(
      (await app.repositories.audit.listByNote(job.noteId)).filter((event) =>
        readEventJobIds(event.payload).some((id) => relatedJobIds.has(id))
      ) as Array<Record<string, unknown>>
    );

    return reply.send({
      ok: true,
      data: sanitize({
        deadLetter: toDeadLetterSummary(job),
        replayLinkage: toReplayLinkageStatus(job, replayJob),
        timeline
      })
    });
  });

  app.get(
    '/operator/writeback/dead-letters/:id/replay-status',
    { preHandler: requireMutationApiKey },
    async (req, reply) => {
      const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
      const job = await app.repositories.writeback.getById(jobId);

      if (!job || !isDeadLetterStatus(job.status)) {
        return sendApiError(
          req,
          reply,
          404,
          DEAD_LETTER_ERROR_CODE.NOT_FOUND,
          `dead-letter not found: ${jobId}`
        );
      }

      const replayJob = job.replayedJobId
        ? await app.repositories.writeback.getById(job.replayedJobId)
        : null;

      return reply.send({
        ok: true,
        data: sanitize({
          deadLetter: toDeadLetterSummary(job),
          replayLinkage: toReplayLinkageStatus(job, replayJob)
        })
      });
    }
  );

  app.post('/operator/writeback/dead-letters/:id/replay', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
    const original = await app.repositories.writeback.getById(jobId);

    if (!original || !isDeadLetterStatus(original.status)) {
      return sendApiError(
        req,
        reply,
        404,
        DEAD_LETTER_ERROR_CODE.NOT_FOUND,
        `dead-letter not found: ${jobId}`
      );
    }
    if (original.status !== 'dead_failed') {
      return sendApiError(
        req,
        reply,
        409,
        DEAD_LETTER_ERROR_CODE.REPLAY_REQUIRES_DEAD_FAILED,
        `cannot replay dead-letter ${original.jobId}: status must be dead_failed; current=${original.status}`
      );
    }
    if (original.replayedJobId) {
      return sendApiError(
        req,
        reply,
        409,
        DEAD_LETTER_ERROR_CODE.REPLAY_ALREADY_EXISTS,
        `dead-letter ${original.jobId} already replayed as ${original.replayedJobId}`
      );
    }

    const note = await app.repositories.notes.getById(original.noteId);
    if (!note) {
      return sendApiError(
        req,
        reply,
        409,
        'WRITEBACK_PRECONDITION_FAILED',
        `note for writeback job is missing: ${original.noteId}`
      );
    }

    if (!canTransitionNoteStatus(note.status, 'writeback_queued')) {
      return sendApiError(
        req,
        reply,
        409,
        'ILLEGAL_NOTE_STATE_TRANSITION',
        `cannot transition note ${note.noteId} from ${note.status} to writeback_queued`
      );
    }

    const replayCreateResult = await app.repositories.writeback.createDeadLetterReplay(original.jobId, {
      jobId: randomUUID(),
      noteId: original.noteId,
      ehr: original.ehr,
      idempotencyKey: `replay-${original.jobId}-${randomUUID()}`,
      operatorStatus: 'open',
      status: 'queued',
      attempts: 0,
      lastError: null,
      lastErrorDetail: null,
      attemptHistory: []
    });

    if (replayCreateResult.outcome === 'original_not_found') {
      return sendApiError(
        req,
        reply,
        404,
        DEAD_LETTER_ERROR_CODE.NOT_FOUND,
        `dead-letter not found: ${jobId}`
      );
    }
    if (replayCreateResult.outcome === 'already_replayed') {
      return sendApiError(
        req,
        reply,
        409,
        DEAD_LETTER_ERROR_CODE.REPLAY_ALREADY_EXISTS,
        `dead-letter ${original.jobId} already replayed as ${replayCreateResult.existingReplayJobId ?? 'another job'}`
      );
    }

    await app.repositories.notes.updateStatus(note.noteId, 'writeback_queued');

    await app.repositories.audit.insert({
      eventId: randomUUID(),
      sessionId: note.sessionId,
      noteId: note.noteId,
      eventType: 'writeback_dead_letter_replayed',
      actor: 'operator',
      payload: {
        originalJobId: original.jobId,
        replayJobId: replayCreateResult.replayJob.jobId,
        originalStatus: original.status,
        reasonCode: readWritebackReasonCode(original.lastErrorDetail)
      }
    });

    const linkedOriginal = await app.repositories.writeback.getById(original.jobId);

    return reply.send({
      ok: true,
      data: sanitize({
        originalJob: linkedOriginal ? toOperatorJob(linkedOriginal) : null,
        replayJob: toOperatorJob(replayCreateResult.replayJob)
      })
    });
  });

  app.post(
    '/operator/writeback/dead-letters/:id/acknowledge',
    { preHandler: requireMutationApiKey },
    async (req, reply) => {
      const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
      const job = await app.repositories.writeback.getById(jobId);

      if (!job || !isDeadLetterStatus(job.status)) {
        return sendApiError(
          req,
          reply,
          404,
          DEAD_LETTER_ERROR_CODE.NOT_FOUND,
          `dead-letter not found: ${jobId}`
        );
      }

      if (job.operatorStatus !== 'open') {
        return sendApiError(
          req,
          reply,
          409,
          DEAD_LETTER_ERROR_CODE.ALREADY_ACKNOWLEDGED,
          `cannot acknowledge dead-letter ${job.jobId}: operatorStatus is ${job.operatorStatus}`
        );
      }

      await app.repositories.writeback.updateOperatorStatus(job.jobId, 'acknowledged');
      const updated = await app.repositories.writeback.getById(job.jobId);

      return reply.send({
        ok: true,
        data: sanitize(updated ? toOperatorJob(updated) : null)
      });
    }
  );

  app.get('/operator/writeback/jobs/:jobId', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse(req.params);
    const job = await app.repositories.writeback.getById(jobId);

    if (!job) {
      return sendApiError(req, reply, 404, 'WRITEBACK_JOB_NOT_FOUND', `writeback job not found: ${jobId}`);
    }

    const timeline = sanitizeTimeline(
      (await app.repositories.audit.listByNote(job.noteId)).filter((event) => {
        const payloadJobId = typeof event.payload.jobId === 'string' ? event.payload.jobId : null;
        return payloadJobId === job.jobId;
      }) as Array<Record<string, unknown>>
    );

    return reply.send({
      ok: true,
      data: sanitize({
        job: toOperatorJob(job),
        attempts: job.attemptHistory.map((attempt) => ({
          ...attempt,
          reasonCode: readWritebackReasonCode(attempt.errorDetail)
        })),
        timeline
      })
    });
  });
};
