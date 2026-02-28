import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';

const execFileAsync = promisify(execFile);
const TEST_API_KEY = 'block5-smoke-key';

let app: FastifyInstance | null = null;

async function getApp() {
  if (!app) {
    app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
  }

  return app;
}

function getBaseUrl(current: FastifyInstance) {
  const address = current.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve server address');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function runSmokeScript(env: Record<string, string | undefined>) {
  const scriptPath = resolve(process.cwd(), 'scripts/local-smoke-e2e.sh');
  return execFileAsync('bash', [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    }
  });
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.API_KEY;
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }

  delete process.env.API_KEY;
});

describe('Block5 regressions: compose->validate->writeback and smoke contract', () => {
  it('prevents duplicate writeback job creation when note already moved out of approved_for_writeback', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();
    const headers = { 'x-api-key': TEST_API_KEY };

    const compose = await current.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers,
      payload: {
        sessionId: 'sess-block5-dup-1',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });
    const noteId = compose.json().data.noteId;

    const validate = await current.inject({
      method: 'POST',
      url: '/api/v1/validation-gate',
      headers,
      payload: {
        noteId,
        unsupportedStatementRate: 0
      }
    });
    expect(validate.statusCode).toBe(200);

    const firstWriteback = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block5-dup-a'
      }
    });
    expect(firstWriteback.statusCode).toBe(200);

    const secondWriteback = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs',
      headers,
      payload: {
        noteId,
        ehr: 'nextgen',
        idempotencyKey: 'idem-block5-dup-b'
      }
    });

    expect(secondWriteback.statusCode).toBe(409);
    expect(secondWriteback.json()).toMatchObject({
      ok: false,
      error: {
        code: 'WRITEBACK_PRECONDITION_FAILED'
      }
    });
  });

  it('transition endpoint returns 404 with stable envelope for unknown job ids', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    const res = await current.inject({
      method: 'POST',
      url: '/api/v1/writeback/jobs/missing-job-id/transition',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { status: 'failed', lastError: 'transport timeout' }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'WRITEBACK_JOB_NOT_FOUND'
      },
      correlationId: expect.any(String)
    });
  });

  it('smoke script prints PASS on success and uses x-api-key when API_KEY is set', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    const result = await runSmokeScript({
      BASE_URL: getBaseUrl(current),
      API_KEY: TEST_API_KEY,
      NODE_ENV: 'test'
    });

    const lines = result.stdout.trim().split('\n');
    expect(lines.at(-1)).toBe('PASS');
  });

  it('smoke script prints FAIL contract when API_KEY is set incorrectly', async () => {
    process.env.API_KEY = TEST_API_KEY;
    const current = await getApp();

    await expect(
      runSmokeScript({
        BASE_URL: getBaseUrl(current),
        API_KEY: 'wrong-key',
        NODE_ENV: 'test'
      })
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('FAIL:')
    });
  });
});
