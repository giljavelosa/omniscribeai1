import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../../lib/apiError.js';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';
import { redactSensitive } from '../../lib/redaction.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';

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

function readReasonCode(detail: Record<string, unknown> | null): string | null {
  if (!detail) {
    return null;
  }

  const reasonCandidate = detail.reasonCode ?? detail.code;
  if (typeof reasonCandidate !== 'string') {
    return null;
  }

  const normalized = reasonCandidate.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function sanitize<T>(payload: T): T {
  return redactSensitive(JSON.parse(JSON.stringify(payload)) as T);
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
      data: sanitize(
        jobs.map((job) => ({
          jobId: job.jobId,
          noteId: job.noteId,
          status: job.status,
          operatorStatus: job.operatorStatus,
          reasonCode: readReasonCode(job.lastErrorDetail),
          attempts: job.attempts,
          updatedAt: job.updatedAt
        }))
      )
    });
  });

  app.get('/operator/writeback/dead-letters/:id', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
    const job = await app.repositories.writeback.getById(jobId);

    if (!job || !isDeadLetterStatus(job.status)) {
      return sendApiError(req, reply, 404, 'DEAD_LETTER_NOT_FOUND', `dead-letter not found: ${jobId}`);
    }

    const timeline = (await app.repositories.audit.listByNote(job.noteId)).filter((event) => {
      const payloadJobId = typeof event.payload.jobId === 'string' ? event.payload.jobId : null;
      const payloadOriginalJobId =
        typeof event.payload.originalJobId === 'string' ? event.payload.originalJobId : null;
      return payloadJobId === job.jobId || payloadOriginalJobId === job.jobId;
    });

    return reply.send({
      ok: true,
      data: sanitize({
        job,
        reasonCode: readReasonCode(job.lastErrorDetail),
        attempts: job.attemptHistory.map((attempt) => ({
          ...attempt,
          reasonCode: readReasonCode(attempt.errorDetail)
        })),
        timeline
      })
    });
  });

  app.post('/operator/writeback/dead-letters/:id/replay', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse({ jobId: (req.params as { id?: string }).id });
    const original = await app.repositories.writeback.getById(jobId);

    if (!original || !isDeadLetterStatus(original.status)) {
      return sendApiError(req, reply, 404, 'DEAD_LETTER_NOT_FOUND', `dead-letter not found: ${jobId}`);
    }
    if (original.status !== 'dead_failed') {
      return sendApiError(
        req,
        reply,
        409,
        'DEAD_LETTER_REPLAY_REQUIRES_DEAD_FAILED',
        `cannot replay dead-letter ${original.jobId}: status must be dead_failed; current=${original.status}`
      );
    }

    if (original.replayedJobId) {
      return sendApiError(
        req,
        reply,
        409,
        'WRITEBACK_REPLAY_ALREADY_EXISTS',
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

    const replayJob = await app.repositories.writeback.insert({
      jobId: randomUUID(),
      noteId: original.noteId,
      ehr: original.ehr,
      idempotencyKey: `replay-${original.jobId}-${randomUUID()}`,
      replayOfJobId: original.jobId,
      replayedJobId: null,
      operatorStatus: 'open',
      status: 'queued',
      attempts: 0,
      lastError: null,
      lastErrorDetail: null,
      attemptHistory: []
    });

    await app.repositories.notes.updateStatus(note.noteId, 'writeback_queued');
    await app.repositories.writeback.linkReplay(original.jobId, replayJob.jobId);

    await app.repositories.audit.insert({
      eventId: randomUUID(),
      sessionId: note.sessionId,
      noteId: note.noteId,
      eventType: 'writeback_dead_letter_replayed',
      actor: 'operator',
      payload: {
        originalJobId: original.jobId,
        replayJobId: replayJob.jobId,
        originalStatus: original.status,
        reasonCode: readReasonCode(original.lastErrorDetail)
      }
    });

    const linkedOriginal = await app.repositories.writeback.getById(original.jobId);
    const linkedReplay = await app.repositories.writeback.getById(replayJob.jobId);

    return reply.send({
      ok: true,
      data: sanitize({
        originalJob: linkedOriginal,
        replayJob: linkedReplay
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
        return sendApiError(req, reply, 404, 'DEAD_LETTER_NOT_FOUND', `dead-letter not found: ${jobId}`);
      }

      if (job.operatorStatus !== 'open') {
        return sendApiError(
          req,
          reply,
          409,
          'DEAD_LETTER_ALREADY_ACKNOWLEDGED',
          `cannot acknowledge dead-letter ${job.jobId}: operatorStatus is ${job.operatorStatus}`
        );
      }

      await app.repositories.writeback.updateOperatorStatus(job.jobId, 'acknowledged');
      const updated = await app.repositories.writeback.getById(job.jobId);

      return reply.send({
        ok: true,
        data: sanitize(updated)
      });
    }
  );

  app.get('/operator/writeback/jobs/:jobId', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = jobIdParamSchema.parse(req.params);
    const job = await app.repositories.writeback.getById(jobId);

    if (!job) {
      return sendApiError(req, reply, 404, 'WRITEBACK_JOB_NOT_FOUND', `writeback job not found: ${jobId}`);
    }

    const timeline = (await app.repositories.audit.listByNote(job.noteId)).filter((event) => {
      const payloadJobId = typeof event.payload.jobId === 'string' ? event.payload.jobId : null;
      return payloadJobId === job.jobId;
    });

    return reply.send({
      ok: true,
      data: sanitize({
        job,
        attempts: job.attemptHistory.map((attempt) => ({
          ...attempt,
          reasonCode: readReasonCode(attempt.errorDetail)
        })),
        timeline
      })
    });
  });
};
