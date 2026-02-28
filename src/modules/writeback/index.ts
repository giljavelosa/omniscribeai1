import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';
import { sendApiError } from '../../lib/apiError.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';
import { resolveFailedTransition } from '../../workers/writebackWorker.js';

const writebackSchema = z.object({
  noteId: z.string(),
  ehr: z.string(),
  idempotencyKey: z.string().min(1)
});

const transitionSchema = z.object({
  status: z.enum(['queued', 'in_progress', 'succeeded', 'failed']),
  lastError: z.string().min(1).optional()
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

      return reply.send({ ok: true, data: existing, idempotentReplay: true });
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
      lastError: null
    });

    await app.repositories.notes.updateStatus(note.noteId, 'writeback_queued');

    return reply.send({
      ok: true,
      data: job
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
        parsed.status === 'failed' ? resolveFailedTransition(job.attempts) : null;
      const nextJobStatus = failedTransition?.status ?? parsed.status;
      const nextAttempts = failedTransition?.nextAttempts ?? job.attempts;

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

      await app.repositories.writeback.updateStatus(job.jobId, nextJobStatus, parsed.lastError, nextAttempts);
      await app.repositories.notes.updateStatus(note.noteId, nextNoteStatus);

      const updated = await app.repositories.writeback.getById(job.jobId);
      return reply.send({ ok: true, data: updated });
    }
  );

  app.get('/writeback/jobs/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await app.repositories.writeback.getById(jobId);

    if (!job) {
      return sendApiError(req, reply, 404, 'WRITEBACK_JOB_NOT_FOUND', `writeback job not found: ${jobId}`);
    }

    return reply.send({ ok: true, data: job });
  });
};
