import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { sendApiError } from '../../lib/apiError.js';
import { requireMutationApiKey } from '../../plugins/apiKeyAuth.js';

const summaryQuerySchema = z.object({
  recentHours: z.coerce.number().int().min(1).max(168).default(24)
});

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

export const operatorWritebackRoutes: FastifyPluginAsync = async (app) => {
  app.get('/operator/writeback/status/summary', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const parsed = summaryQuerySchema.parse(req.query ?? {});
    const since = new Date(Date.now() - parsed.recentHours * 60 * 60 * 1000).toISOString();
    const summary = await app.repositories.writeback.getStatusSummary(since);

    return reply.send({
      ok: true,
      data: {
        countsByStatus: summary.countsByStatus,
        recentFailures: {
          ...summary.recentFailures,
          windowHours: parsed.recentHours
        }
      }
    });
  });

  app.get('/operator/writeback/jobs/:jobId', { preHandler: requireMutationApiKey }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
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
      data: {
        job,
        attempts: job.attemptHistory.map((attempt) => ({
          ...attempt,
          reasonCode: readReasonCode(attempt.errorDetail)
        })),
        timeline
      }
    });
  });
};
