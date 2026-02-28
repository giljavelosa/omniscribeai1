import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const API_KEY = 'block3-test-key';

describe('Block3 auth boundary for mutation endpoints', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('returns 401 envelope for unauthorized mutation when API_KEY is set', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      payload: {
        sessionId: 'sess-auth-unauth-1',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: expect.any(String)
      }
    });

    await app.close();
  });

  it('allows authorized mutation with valid x-api-key when API_KEY is set', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers: {
        'x-api-key': API_KEY
      },
      payload: {
        sessionId: 'sess-auth-ok-1',
        division: 'medical',
        noteFamily: 'progress_note'
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      data: {
        noteId: expect.any(String),
        status: expect.stringMatching(/draft_(created|ready)/)
      }
    });

    await app.close();
  });

  it('rejects unauthorized read access to writeback job list', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED'
      }
    });

    await app.close();
  });

  it('rejects unauthorized read access to individual writeback jobs', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/writeback/jobs/non-existent-job'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED'
      }
    });

    await app.close();
  });

  it('rejects unauthorized read access to operator writeback summary', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/status/summary'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED'
      }
    });

    await app.close();
  });

  it('rejects unauthorized read access to operator writeback job details', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/writeback/jobs/non-existent-job'
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'UNAUTHORIZED'
      }
    });

    await app.close();
  });
});
