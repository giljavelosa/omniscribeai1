import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../../lib/apiError.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';

const composeSchema = z.object({
  sessionId: z.string(),
  division: z.enum(['medical', 'rehab', 'bh']),
  noteFamily: z.string(),
  useExistingFacts: z.boolean().default(false)
});

const DIVISION_TEMPLATES: Record<'medical' | 'rehab' | 'bh', string[]> = {
  medical: ['Chief Complaint', 'HPI', 'Assessment', 'Plan'],
  rehab: ['Functional Status', 'Interventions', 'Response to Treatment', 'Plan of Care'],
  bh: ['Presenting Concern', 'Mental Status Exam', 'Risk Assessment', 'Care Plan']
};

function buildDeterministicBody(division: 'medical' | 'rehab' | 'bh', noteFamily: string): string {
  const sections = DIVISION_TEMPLATES[division].map((heading) => `## ${heading}\n- `).join('\n\n');
  return `# ${division.toUpperCase()} ${noteFamily}\n\n${sections}`;
}

function appendFactSummary(body: string, factCount: number): string {
  if (factCount === 0) {
    return body;
  }

  return `${body}\n\n## Fact Signals\n- Included ${factCount} extracted fact(s) from ledger.`;
}

export const noteComposeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/note-compose', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = composeSchema.parse(req.body);

    const session = await app.repositories.sessions.getById(parsed.sessionId);
    if (!session) {
      await app.repositories.sessions.upsert({
        sessionId: parsed.sessionId,
        division: parsed.division,
        status: 'composing'
      });
    } else if (session.division !== parsed.division) {
      return sendApiError(
        req,
        reply,
        409,
        'SESSION_DIVISION_MISMATCH',
        `session ${parsed.sessionId} is ${session.division}, not ${parsed.division}`
      );
    }

    const facts = parsed.useExistingFacts
      ? await app.repositories.facts.listBySession(parsed.sessionId)
      : [];
    const factCount = facts.length;

    const noteId = randomUUID();
    const note = await app.repositories.notes.insert({
      noteId,
      sessionId: parsed.sessionId,
      division: parsed.division,
      noteFamily: parsed.noteFamily,
      body: appendFactSummary(buildDeterministicBody(parsed.division, parsed.noteFamily), factCount),
      status: 'draft_created'
    });

    return reply.send({
      ok: true,
      data: {
        ...note,
        metadata: {
          factCount,
          usedExistingFacts: parsed.useExistingFacts
        }
      }
    });
  });
};
