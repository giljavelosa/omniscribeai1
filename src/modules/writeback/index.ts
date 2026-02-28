import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';
import type { WritebackAttempt } from '../../repositories/contracts.js';
import { sendApiError } from '../../lib/apiError.js';
import { redactSensitive } from '../../lib/redaction.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';
import { resolveFailedTransition } from '../../workers/writebackWorker.js';

const writebackSchema = z.object({
  noteId: z.string(),
  ehr: z.string(),
  idempotencyKey: z.string().min(1)
});

const transitionSchema = z
  .object({
    status: z.enum(['queued', 'in_progress', 'succeeded', 'failed']),
    lastError: z.string().trim().min(1).optional(),
    lastErrorDetail: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((payload, ctx) => {
    if (payload.status === 'failed' && !payload.lastError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lastError is required when status is failed',
        path: ['lastError']
      });
    }

    if (payload.status !== 'failed' && (payload.lastError || payload.lastErrorDetail)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lastError/lastErrorDetail are only allowed when status is failed',
        path: ['lastErrorDetail']
      });
    }
  });

const listSchema = z.object({
  state: z
    .enum(['queued', 'in_progress', 'retryable_failed', 'dead_failed', 'succeeded', 'failed'])
    .optional(),
  noteId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const ALLOWED_JOB_TRANSITIONS: Record<string, Set<string>> = {
  queued: new Set(['in_progress', 'failed']),
  in_progress: new Set(['succeeded', 'failed']),
  failed: new Set(['queued']),
  retryable_failed: new Set(['queued']),
  dead_failed: new Set([]),
  succeeded: new Set([])
};

const JOB_TO_NOTE_STATUS: Record<string, string> = {
  queued: 'writeback_queued',
  in_progress: 'writeback_in_progress',
  retryable_failed: 'writeback_failed',
  dead_failed: 'writeback_failed',
  failed: 'writeback_failed',
  succeeded: 'writeback_succeeded'
};

function canTransitionWritebackJob(from: string, to: string): boolean {
  return ALLOWED_JOB_TRANSITIONS[from]?.has(to) ?? false;
}

function readFailureReasonCode(detail?: Record<string, unknown>): string | null {
  const reasonCandidate = detail?.reasonCode ?? detail?.code;
  if (typeof reasonCandidate !== 'string') {
    return null;
  }

  const normalized = reasonCandidate.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeWritebackResponse<T>(payload: T): T {
  return redactSensitive(JSON.parse(JSON.stringify(payload)) as T);
}

export const writebackRoutes: FastifyPluginAsync = async (app) => {
  app.post('/writeback/jobs', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = writebackSchema.parse(req.body);

    if (parsed.ehr !== 'nextgen') {
      return sendApiError(
        req,
        reply,
        400,
        'UNSUPPORTED_EHR_TARGET',
        `Sprint 1 supports ehr target nextgen only; received ${parsed.ehr}`
      );
    }

    const existing = await app.repositories.writeback.getByIdempotencyKey(parsed.idempotencyKey);
    if (existing) {
      if (existing.noteId !== parsed.noteId || existing.ehr !== parsed.ehr) {
        return sendApiError(
          req,
          reply,
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
          `idempotency key ${parsed.idempotencyKey} is already bound to another writeback request`
        );
      }

      return reply.send({ ok: true, data: sanitizeWritebackResponse(existing), idempotentReplay: true });
    }

    const note = await app.repositories.notes.getById(parsed.noteId);
    if (!note) {
      return sendApiError(req, reply, 404, 'NOTE_NOT_FOUND', `note not found: ${parsed.noteId}`);
    }

    const latestValidation = await app.repositories.validation.getLatestByNote(parsed.noteId);
    if (!latestValidation || latestValidation.decision !== 'approved_for_writeback') {
      return sendApiError(
        req,
        reply,
        409,
        'WRITEBACK_PRECONDITION_FAILED',
        'only approved notes can queue writeback'
      );
    }

    if (note.status !== 'approved_for_writeback') {
      return sendApiError(
        req,
        reply,
        409,
        'WRITEBACK_PRECONDITION_FAILED',
        `note ${note.noteId} must be approved_for_writeback before queueing; current=${note.status}`
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

    const job = await app.repositories.writeback.insert({
      jobId: randomUUID(),
      noteId: note.noteId,
      ehr: 'nextgen',
      idempotencyKey: parsed.idempotencyKey,
      status: 'queued',
      attempts: 0,
      lastError: null,
      lastErrorDetail: null,
      attemptHistory: []
    });

    await app.repositories.notes.updateStatus(note.noteId, 'writeback_queued');
    await app.repositories.audit.insert({
      eventId: randomUUID(),
      sessionId: note.sessionId,
      noteId: note.noteId,
      eventType: 'writeback_job_queued',
      actor: 'system',
      payload: {
        jobId: job.jobId,
        ehr: job.ehr,
        status: job.status
      }
    });

    return reply.send({
      ok: true,
      data: sanitizeWritebackResponse(job)
    });
  });

  app.post(
    '/writeback/jobs/:jobId/transition',
    { preHandler: requireMutationApiKey },
    async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      const parsed = transitionSchema.parse(req.body);

      const job = await app.repositories.writeback.getById(jobId);
      if (!job) {
        return sendApiError(req, reply, 404, 'WRITEBACK_JOB_NOT_FOUND', `writeback job not found: ${jobId}`);
      }

      if (!canTransitionWritebackJob(job.status, parsed.status)) {
        return sendApiError(
          req,
          reply,
          409,
          'ILLEGAL_WRITEBACK_STATE_TRANSITION',
          `cannot transition writeback job ${job.jobId} from ${job.status} to ${parsed.status}`
        );
      }

      const failedTransition =
        parsed.status === 'failed'
          ? resolveFailedTransition(job.attempts, undefined, readFailureReasonCode(parsed.lastErrorDetail))
          : null;
      const nextJobStatus = failedTransition?.status ?? parsed.status;
      const nextAttempts = failedTransition?.nextAttempts ?? job.attempts;
      const nextAttemptHistory: WritebackAttempt[] =
        parsed.status === 'failed' && parsed.lastError
          ? [
              ...job.attemptHistory,
              {
                attempt: nextAttempts,
                fromStatus: job.status,
                toStatus: nextJobStatus,
                error: parsed.lastError,
                errorDetail: parsed.lastErrorDetail ?? null,
                occurredAt: new Date().toISOString()
              }
            ]
          : job.attemptHistory;

      const note = await app.repositories.notes.getById(job.noteId);
      if (!note) {
        return sendApiError(
          req,
          reply,
          409,
          'WRITEBACK_PRECONDITION_FAILED',
          `note for writeback job is missing: ${job.noteId}`
        );
      }

      const nextNoteStatus = JOB_TO_NOTE_STATUS[nextJobStatus];
      if (!canTransitionNoteStatus(note.status, nextNoteStatus)) {
        return sendApiError(
          req,
          reply,
          409,
          'ILLEGAL_NOTE_STATE_TRANSITION',
          `cannot transition note ${note.noteId} from ${note.status} to ${nextNoteStatus}`
        );
      }

      await app.repositories.writeback.updateStatus(job.jobId, nextJobStatus, {
        attempts: nextAttempts,
        lastError: parsed.status === 'failed' ? parsed.lastError ?? null : null,
        lastErrorDetail: parsed.status === 'failed' ? parsed.lastErrorDetail ?? null : null,
        attemptHistory: nextAttemptHistory
      });
      await app.repositories.notes.updateStatus(note.noteId, nextNoteStatus);
      await app.repositories.audit.insert({
        eventId: randomUUID(),
        sessionId: note.sessionId,
        noteId: note.noteId,
        eventType: 'writeback_transition_applied',
        actor: 'system',
        payload: {
          jobId: job.jobId,
          fromStatus: job.status,
          requestedStatus: parsed.status,
          resolvedStatus: nextJobStatus,
          attemptsBefore: job.attempts,
          attemptsAfter: nextAttempts,
          noteStatusBefore: note.status,
          noteStatusAfter: nextNoteStatus
        }
      });

      const updated = await app.repositories.writeback.getById(job.jobId);
      return reply.send({ ok: true, data: sanitizeWritebackResponse(updated) });
    }
  );

  app.get('/writeback/jobs', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = listSchema.parse(req.query ?? {});
    const jobs = await app.repositories.writeback.list({
      state: parsed.state,
      noteId: parsed.noteId,
      limit: parsed.limit
    });

    return reply.send({ ok: true, data: sanitizeWritebackResponse(jobs) });
  });

  app.get('/writeback/jobs/:jobId', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await app.repositories.writeback.getById(jobId);

    if (!job) {
      return sendApiError(req, reply, 404, 'WRITEBACK_JOB_NOT_FOUND', `writeback job not found: ${jobId}`);
    }

    return reply.send({ ok: true, data: sanitizeWritebackResponse(job) });
  });
};
