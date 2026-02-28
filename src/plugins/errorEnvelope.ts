import { FastifyPluginAsync } from 'fastify';

const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred';

type ErrorWithStatusCode = Error & { statusCode?: number };

function toErrorWithStatusCode(error: unknown): ErrorWithStatusCode {
  if (error instanceof Error) {
    return error as ErrorWithStatusCode;
  }

  return {
    name: 'UnknownError',
    message: 'Unknown error',
    statusCode: 500
  };
}

export const errorEnvelopePlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error, req, reply) => {
    const safeError = toErrorWithStatusCode(error);
    const statusCode =
      typeof safeError.statusCode === 'number' && safeError.statusCode >= 400
        ? safeError.statusCode
        : 500;
    const correlationId = String(
      reply.getHeader('x-correlation-id') ?? req.headers['x-correlation-id'] ?? ''
    );

    const isValidationError = safeError.name === 'ZodError';
    const code = isValidationError
      ? 'VALIDATION_ERROR'
      : statusCode >= 500
        ? 'INTERNAL_ERROR'
        : 'REQUEST_ERROR';
    const message =
      statusCode >= 500 && !isValidationError ? INTERNAL_ERROR_MESSAGE : safeError.message;

    req.log.error(
      {
        err: safeError,
        correlationId
      },
      'request.failed'
    );

    return reply.status(statusCode).send({
      ok: false,
      error: {
        code,
        message
      },
      correlationId
    });
  });

  app.setNotFoundHandler(async (req, reply) => {
    const correlationId = String(
      reply.getHeader('x-correlation-id') ?? req.headers['x-correlation-id'] ?? ''
    );
    return reply.status(404).send({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found'
      },
      correlationId
    });
  });
};
