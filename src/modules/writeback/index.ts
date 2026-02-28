import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';

const writebackSchema = z.object({
  noteId: z.string(),
  ehr: z.string(),
  idempotencyKey: z.string().min(1)
});

export const writebackRoutes: FastifyPluginAsync = async (app) => {
  app.post('/writeback/jobs', async (req, reply) => {
    const parsed = writebackSchema.parse(req.body);

    if (parsed.ehr !== 'nextgen') {
      return reply.code(400).send({
        ok: false,
        error: 'unsupported_ehr_target',
        message: `Sprint 1 supports ehr target nextgen only; received ${parsed.ehr}`
      });
    }


    const existing = await app.repositories.writeback.getByIdempotencyKey(parsed.idempotencyKey);
    if (existing) {
      return reply.send({ ok: true, data: existing, idempotentReplay: true });
    }

    const note = await app.repositories.notes.getById(parsed.noteId);
    if (!note) {
      return reply.code(404).send({
        ok: false,
        error: 'not_found',
        message: `note not found: ${parsed.noteId}`
      });
    }

    const latestValidation = await app.repositories.validation.getLatestByNote(parsed.noteId);
    if (!latestValidation || latestValidation.decision !== 'approved_for_writeback') {
      return reply.code(409).send({
        ok: false,
        error: 'writeback_precondition_failed',
        message: 'only approved notes can queue writeback'
      });
    }

    if (note.status !== 'approved_for_writeback') {
      return reply.code(409).send({
        ok: false,
        error: 'writeback_precondition_failed',
        message: `note ${note.noteId} must be approved_for_writeback before queueing; current=${note.status}`
      });
    }

    if (!canTransitionNoteStatus(note.status, 'writeback_queued')) {
      return reply.code(409).send({
        ok: false,
        error: 'invalid_note_state_transition',
        message: `cannot transition note ${note.noteId} from ${note.status} to writeback_queued`
      });
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

  app.get('/writeback/jobs/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await app.repositories.writeback.getById(jobId);

    if (!job) {
      return reply.code(404).send({
        ok: false,
        error: 'not_found',
        message: `writeback job not found: ${jobId}`
      });
    }

    return reply.send({ ok: true, data: job });
  });
};
