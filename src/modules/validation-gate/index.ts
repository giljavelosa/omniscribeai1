import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ValidationDecision } from '../../repositories/contracts.js';
import { canTransitionNoteStatus } from '../../lib/noteStateMachine.js';

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

export const validationGateRoutes: FastifyPluginAsync = async (app) => {
  app.post('/validation-gate', async (req, reply) => {
    const parsed = validateSchema.parse(req.body);

    const note = await app.repositories.notes.getById(parsed.noteId);
    if (!note) {
      return reply.code(404).send({
        ok: false,
        error: 'not_found',
        message: `note not found: ${parsed.noteId}`
      });
    }

    const division = parsed.division ?? note.division;
    if (division !== note.division) {
      return reply.code(400).send({
        ok: false,
        error: 'division_mismatch',
        message: `division mismatch for note ${note.noteId}: expected ${note.division}, got ${division}`
      });
    }

    const decision = decideValidation(note.division, parsed.unsupportedStatementRate);

    if (!canTransitionNoteStatus(note.status, decision)) {
      return reply.code(409).send({
        ok: false,
        error: 'invalid_note_state_transition',
        message: `cannot transition note ${note.noteId} from ${note.status} to ${decision}`
      });
    }

    const result = await app.repositories.validation.insert({
      resultId: randomUUID(),
      noteId: note.noteId,
      sessionId: note.sessionId,
      decision,
      unsupportedStatementRate: parsed.unsupportedStatementRate,
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
