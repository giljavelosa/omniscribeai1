import type { FastifyPluginAsync } from 'fastify';

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sessions/:sessionId/status', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };

    const session = await app.repositories.sessions.getById(sessionId);
    if (!session) {
      return reply.code(404).send({
        ok: false,
        data: {
          sessionId,
          message: 'session not found'
        }
      });
    }

    const [segmentsIngested, events] = await Promise.all([
      app.repositories.segments.countBySession(sessionId),
      app.repositories.audit.listBySession(sessionId)
    ]);

    const factExtractionQueued = events.some((event) => event.eventType === 'fact_extraction_queued');

    return reply.send({
      ok: true,
      data: {
        sessionId,
        division: session.division,
        status: session.status,
        segmentsIngested,
        lastIngestedAt: session.lastIngestedAt,
        factExtraction: {
          queued: factExtractionQueued
        }
      }
    });
  });
};
