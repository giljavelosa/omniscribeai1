import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';
import type { ValidationDecision } from '../../repositories/contracts.js';
import { sendApiError } from '../../lib/apiError.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';

const validateSchema = z.object({
  noteId: z.string(),
  division: z.enum(['medical', 'rehab', 'bh']).optional(),
  unsupportedStatementRate: z.number().min(0).max(1).default(0)
});

function decideValidation(
  division: 'medical' | 'rehab' | 'bh',
  unsupportedStatementRate: number
): ValidationDecision {
  if (division === 'bh') {
    if (unsupportedStatementRate > 0) {
      return 'blocked';
    }

    return 'needs_review';
  }

  if (unsupportedStatementRate <= 0.05) {
    return 'approved_for_writeback';
  }

  if (unsupportedStatementRate <= 0.2) {
    return 'needs_review';
  }

  return 'blocked';
}

function buildReasons(
  division: 'medical' | 'rehab' | 'bh',
  unsupportedStatementRate: number,
  decision: ValidationDecision
): string[] {
  if (division === 'bh') {
    if (unsupportedStatementRate > 0) {
      return ['bh_requires_zero_unsupported', 'unsupported_statements_detected'];
    }

    return ['bh_requires_manual_review_even_when_supported'];
  }

  if (decision === 'approved_for_writeback') {
    return ['unsupported_rate_at_or_below_auto_approve_threshold'];
  }

  if (decision === 'needs_review') {
    return ['unsupported_rate_in_manual_review_band'];
  }

  return ['unsupported_rate_above_block_threshold'];
}

export const validationGateRoutes: FastifyPluginAsync = async (app) => {
  app.post('/validation-gate', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = validateSchema.parse(req.body);

    const note = await app.repositories.notes.getById(parsed.noteId);
    if (!note) {
      return sendApiError(req, reply, 404, 'NOTE_NOT_FOUND', `note not found: ${parsed.noteId}`);
    }

    const division = parsed.division ?? note.division;
    if (division !== note.division) {
      return sendApiError(
        req,
        reply,
        400,
        'DIVISION_MISMATCH',
        `division mismatch for note ${note.noteId}: expected ${note.division}, got ${division}`
      );
    }

    const decision = decideValidation(note.division, parsed.unsupportedStatementRate);
    const reasons = buildReasons(note.division, parsed.unsupportedStatementRate, decision);

    if (!canTransitionNoteStatus(note.status, decision)) {
      return sendApiError(
        req,
        reply,
        409,
        'ILLEGAL_NOTE_STATE_TRANSITION',
        `cannot transition note ${note.noteId} from ${note.status} to ${decision}`
      );
    }

    const result = await app.repositories.validation.insert({
      resultId: randomUUID(),
      noteId: note.noteId,
      sessionId: note.sessionId,
      decision,
      unsupportedStatementRate: parsed.unsupportedStatementRate,
      reasons,
      details: {
        division: note.division,
        policy: note.division === 'bh' ? 'bh_strict_default' : 'default_v1'
      }
    });

    await app.repositories.notes.updateStatus(note.noteId, decision);

    return reply.send({
      ok: true,
      data: result
    });
  });
};
