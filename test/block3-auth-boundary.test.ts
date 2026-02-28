import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const API_KEY = process.env.API_KEY;

describe('Block3 auth boundary for mutation endpoints', () => {
  it('returns 401 envelope for unauthorized mutation when API_KEY is set', async () => {
    expect(API_KEY, 'Set API_KEY in test env to run Block3 auth tests').toBeTruthy();

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
    expect(API_KEY, 'Set API_KEY in test env to run Block3 auth tests').toBeTruthy();

    const app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/note-compose',
      headers: {
        'x-api-key': API_KEY as string
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
});
