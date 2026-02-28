import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
describe('health', () => {
    it('returns ok', async () => {
        const app = buildApp();
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.ok).toBe(true);
        await app.close();
    });
});
