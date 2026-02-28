import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'test-api-key';

type EndpointCase = {
  name: string;
  method: 'POST';
  url: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
};

type MatrixEntry = {
  endpoint: string;
  statuses: number[];
  errorCodes: string[];
};

describe('phase3 pr2 deterministic error-code matrix snapshots', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEY = TEST_API_KEY;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('snapshots allowed status and error-code matrix for core endpoints', async () => {
    const app = buildApp();

    const missingApiKeyCases: EndpointCase[] = [
      {
        name: 'transcript-ingest unauthorized',
        method: 'POST',
        url: '/api/v1/transcript-ingest',
        payload: {
          sessionId: 'sess-pr2-missing-auth',
          division: 'medical',
          segments: [
            {
              segmentId: 'seg-1',
              speaker: 'clinician',
              startMs: 0,
              endMs: 100,
              text: 'hello'
            }
          ]
        }
      },
      {
        name: 'note-compose unauthorized',
        method: 'POST',
        url: '/api/v1/note-compose',
        payload: {
          sessionId: 'sess-pr2-missing-auth',
          division: 'medical',
          noteFamily: 'progress_note'
        }
      },
      {
        name: 'validation-gate unauthorized',
        method: 'POST',
        url: '/api/v1/validation-gate',
        payload: {
          noteId: 'note-pr2-missing-auth',
          unsupportedStatementRate: 0.01
        }
      },
      {
        name: 'writeback/jobs unauthorized',
        method: 'POST',
        url: '/api/v1/writeback/jobs',
        payload: {
          noteId: '00000000-0000-0000-0000-000000000000',
          ehr: 'nextgen',
          idempotencyKey: 'idem-pr2-missing-auth'
        }
      }
    ];

    const authorizedCases: EndpointCase[] = [
      {
        name: 'transcript-ingest validation error',
        method: 'POST',
        url: '/api/v1/transcript-ingest',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          sessionId: 'sess-pr2-ingest-validation',
          division: 'medical',
          segments: []
        }
      },
      {
        name: 'note-compose validation error',
        method: 'POST',
        url: '/api/v1/note-compose',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          sessionId: 'sess-pr2-compose-validation',
          division: 'medical',
          noteFamily: ''
        }
      },
      {
        name: 'validation-gate note missing',
        method: 'POST',
        url: '/api/v1/validation-gate',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          noteId: 'missing-pr2-note',
          unsupportedStatementRate: 0.01
        }
      },
      {
        name: 'writeback/jobs note missing',
        method: 'POST',
        url: '/api/v1/writeback/jobs',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          noteId: '00000000-0000-0000-0000-000000000000',
          ehr: 'nextgen',
          idempotencyKey: 'idem-pr2-note-missing'
        }
      },
      {
        name: 'writeback/jobs unsupported ehr target',
        method: 'POST',
        url: '/api/v1/writeback/jobs',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          noteId: '00000000-0000-0000-0000-000000000000',
          ehr: 'epic',
          idempotencyKey: 'idem-pr2-unsupported-ehr'
        }
      }
    ];

    const allCases = [...missingApiKeyCases, ...authorizedCases];
    const perEndpoint = new Map<string, { statuses: Set<number>; errorCodes: Set<string> }>();

    for (const testCase of allCases) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        payload: testCase.payload,
        headers: testCase.headers
      });

      const body = response.json() as {
        ok: boolean;
        error?: {
          code?: string;
        };
      };

      expect(body.ok).toBe(false);
      expect(body.error?.code).toBeTruthy();

      const entry =
        perEndpoint.get(testCase.url) ??
        {
          statuses: new Set<number>(),
          errorCodes: new Set<string>()
        };

      entry.statuses.add(response.statusCode);
      entry.errorCodes.add(body.error?.code as string);
      perEndpoint.set(testCase.url, entry);
    }

    const snapshotMatrix: MatrixEntry[] = Array.from(perEndpoint.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([endpoint, data]) => ({
        endpoint,
        statuses: Array.from(data.statuses).sort((a, b) => a - b),
        errorCodes: Array.from(data.errorCodes).sort((a, b) => a.localeCompare(b))
      }));

    expect(snapshotMatrix).toMatchInlineSnapshot(`
      [
        {
          "endpoint": "/api/v1/note-compose",
          "errorCodes": [
            "UNAUTHORIZED",
            "VALIDATION_ERROR",
          ],
          "statuses": [
            400,
            401,
          ],
        },
        {
          "endpoint": "/api/v1/transcript-ingest",
          "errorCodes": [
            "TRANSCRIPT_SEGMENTS_REQUIRED",
            "UNAUTHORIZED",
          ],
          "statuses": [
            400,
            401,
          ],
        },
        {
          "endpoint": "/api/v1/validation-gate",
          "errorCodes": [
            "NOTE_NOT_FOUND",
            "UNAUTHORIZED",
          ],
          "statuses": [
            401,
            404,
          ],
        },
        {
          "endpoint": "/api/v1/writeback/jobs",
          "errorCodes": [
            "NOTE_NOT_FOUND",
            "UNAUTHORIZED",
            "UNSUPPORTED_EHR_TARGET",
          ],
          "statuses": [
            400,
            401,
            404,
          ],
        },
      ]
    `);

    await app.close();
  });
});
