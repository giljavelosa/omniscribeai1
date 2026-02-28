import type { FastifyReply, FastifyRequest } from 'fastify';

export type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  correlationId: string;
};

export function getCorrelationId(req: FastifyRequest, reply: FastifyReply): string {
  return String(reply.getHeader('x-correlation-id') ?? req.headers['x-correlation-id'] ?? '');
}

export function sendApiError(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
) {
  const body: ErrorEnvelope = {
    ok: false,
    error: {
      code,
      message
    },
    correlationId: getCorrelationId(req, reply)
  };

  return reply.code(statusCode).send(body);
}

