import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { sendApiError } from '../lib/apiError.js';

let warnedAboutMissingApiKey = false;

function readApiKeyHeader(req: FastifyRequest): string {
  const value = req.headers['x-api-key'];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

export async function requireMutationApiKey(req: FastifyRequest, reply: FastifyReply) {
  if (!env.API_KEY) {
    if (env.NODE_ENV === 'development') {
      if (!warnedAboutMissingApiKey) {
        warnedAboutMissingApiKey = true;
        req.log.warn(
          {
            route: req.url
          },
          'auth.api_key_missing_in_development_allowing_request'
        );
      }
      return;
    }

    return sendApiError(
      req,
      reply,
      503,
      'AUTH_MISCONFIGURED',
      'API key authentication is not configured for this environment'
    );
  }

  const providedApiKey = readApiKeyHeader(req);
  if (providedApiKey !== env.API_KEY) {
    return sendApiError(req, reply, 401, 'UNAUTHORIZED', 'Invalid API key');
  }
}

