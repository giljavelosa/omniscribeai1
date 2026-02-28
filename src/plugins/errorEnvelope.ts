import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import { getCorrelationId } from '../lib/apiError.js';

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

const errorEnvelope: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error, req, reply) => {
    const safeError = toErrorWithStatusCode(error);
    const isValidationError = error instanceof ZodError || safeError.name === 'ZodError';
    const baseStatusCode =
      typeof safeError.statusCode === 'number' && safeError.statusCode >= 400
        ? safeError.statusCode
        : 500;
    const statusCode = isValidationError ? 400 : baseStatusCode;
    const correlationId = getCorrelationId(req, reply);
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
    const correlationId = getCorrelationId(req, reply);
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

export const errorEnvelopePlugin = fp(errorEnvelope);
