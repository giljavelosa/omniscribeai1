import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const TEST_API_KEY = 'test-api-key';

type EndpointCase = {
  name: string;
  method: 'POST';
  url: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  expectedStatus: number;
  expectedErrorCode: string;
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

    const testCases: EndpointCase[] = [
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
        },
        expectedStatus: 401,
        expectedErrorCode: 'UNAUTHORIZED'
      },
      {
        name: 'note-compose unauthorized',
        method: 'POST',
        url: '/api/v1/note-compose',
        payload: {
          sessionId: 'sess-pr2-missing-auth',
          division: 'medical',
          noteFamily: 'progress_note'
        },
        expectedStatus: 401,
        expectedErrorCode: 'UNAUTHORIZED'
      },
      {
        name: 'validation-gate unauthorized',
        method: 'POST',
        url: '/api/v1/validation-gate',
        payload: {
          noteId: 'note-pr2-missing-auth',
          unsupportedStatementRate: 0.01
        },
        expectedStatus: 401,
        expectedErrorCode: 'UNAUTHORIZED'
      },
      {
        name: 'writeback/jobs unauthorized',
        method: 'POST',
        url: '/api/v1/writeback/jobs',
        payload: {
          noteId: '00000000-0000-0000-0000-000000000000',
          ehr: 'nextgen',
          idempotencyKey: 'idem-pr2-missing-auth'
        },
        expectedStatus: 401,
        expectedErrorCode: 'UNAUTHORIZED'
      },
      {
        name: 'transcript-ingest validation error',
        method: 'POST',
        url: '/api/v1/transcript-ingest',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          sessionId: 'sess-pr2-ingest-validation',
          division: 'medical',
          segments: []
        },
        expectedStatus: 400,
        expectedErrorCode: 'TRANSCRIPT_SEGMENTS_REQUIRED'
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
        },
        expectedStatus: 400,
        expectedErrorCode: 'VALIDATION_ERROR'
      },
      {
        name: 'validation-gate note missing',
        method: 'POST',
        url: '/api/v1/validation-gate',
        headers: { 'x-api-key': TEST_API_KEY },
        payload: {
          noteId: 'missing-pr2-note',
          unsupportedStatementRate: 0.01
        },
        expectedStatus: 404,
        expectedErrorCode: 'NOTE_NOT_FOUND'
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
        },
        expectedStatus: 404,
        expectedErrorCode: 'NOTE_NOT_FOUND'
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
        },
        expectedStatus: 400,
        expectedErrorCode: 'UNSUPPORTED_EHR_TARGET'
      }
    ];

    const observedOutcomes: Array<{
      caseName: string;
      endpoint: string;
      status: number;
      errorCode: string;
    }> = [];

    const perEndpoint = new Map<string, { statuses: Set<number>; errorCodes: Set<string> }>();

    for (const testCase of testCases) {
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
      expect(body.error?.code).toBe(testCase.expectedErrorCode);
      expect(response.statusCode).toBe(testCase.expectedStatus);

      observedOutcomes.push({
        caseName: testCase.name,
        endpoint: testCase.url,
        status: response.statusCode,
        errorCode: body.error?.code as string
      });

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

    expect(observedOutcomes).toMatchInlineSnapshot(`
      [
        {
          "caseName": "transcript-ingest unauthorized",
          "endpoint": "/api/v1/transcript-ingest",
          "errorCode": "UNAUTHORIZED",
          "status": 401,
        },
        {
          "caseName": "note-compose unauthorized",
          "endpoint": "/api/v1/note-compose",
          "errorCode": "UNAUTHORIZED",
          "status": 401,
        },
        {
          "caseName": "validation-gate unauthorized",
          "endpoint": "/api/v1/validation-gate",
          "errorCode": "UNAUTHORIZED",
          "status": 401,
        },
        {
          "caseName": "writeback/jobs unauthorized",
          "endpoint": "/api/v1/writeback/jobs",
          "errorCode": "UNAUTHORIZED",
          "status": 401,
        },
        {
          "caseName": "transcript-ingest validation error",
          "endpoint": "/api/v1/transcript-ingest",
          "errorCode": "TRANSCRIPT_SEGMENTS_REQUIRED",
          "status": 400,
        },
        {
          "caseName": "note-compose validation error",
          "endpoint": "/api/v1/note-compose",
          "errorCode": "VALIDATION_ERROR",
          "status": 400,
        },
        {
          "caseName": "validation-gate note missing",
          "endpoint": "/api/v1/validation-gate",
          "errorCode": "NOTE_NOT_FOUND",
          "status": 404,
        },
        {
          "caseName": "writeback/jobs note missing",
          "endpoint": "/api/v1/writeback/jobs",
          "errorCode": "NOTE_NOT_FOUND",
          "status": 404,
        },
        {
          "caseName": "writeback/jobs unsupported ehr target",
          "endpoint": "/api/v1/writeback/jobs",
          "errorCode": "UNSUPPORTED_EHR_TARGET",
          "status": 400,
        },
      ]
    `);

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
