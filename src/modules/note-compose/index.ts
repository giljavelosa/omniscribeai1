import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const composeSchema = z.object({
  sessionId: z.string(),
  division: z.enum(['medical', 'rehab', 'bh']),
  noteFamily: z.string()
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

export const noteComposeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/note-compose', async (req, reply) => {
    const parsed = composeSchema.parse(req.body);

    const session = await app.repositories.sessions.getById(parsed.sessionId);
    if (!session) {
      await app.repositories.sessions.upsert({
        sessionId: parsed.sessionId,
        division: parsed.division,
        status: 'composing'
      });
    }

    const noteId = randomUUID();
    const note = await app.repositories.notes.insert({
      noteId,
      sessionId: parsed.sessionId,
      division: parsed.division,
      noteFamily: parsed.noteFamily,
      body: buildDeterministicBody(parsed.division, parsed.noteFamily),
      status: 'draft_created'
    });

    return reply.send({ ok: true, data: note });
  });
};
