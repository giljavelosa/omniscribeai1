# Phase2 Block6 Operator API Contract

Scope: `GET /operator/writeback/status/summary`, dead-letter list/detail/history/replay/replay-status/acknowledge.

Base path: `/api/v1/operator/writeback`

Auth: all endpoints require `X-API-Key` when `API_KEY` is configured.

## Envelope Contract

Success envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "human-readable message"
  },
  "correlationId": "uuid"
}
```

Reason code normalization:
- Response field name is always `reasonCode`.
- Server accepts both `reasonCode` and legacy `code` in writeback failure details, and normalizes to uppercase in operator responses.

## `GET /status/summary`

Query:
- `recentHours` integer, optional, `1..168`, default `24`.

Success `200`:
- `data.countsByStatus`: object map of writeback status -> count.
- `data.deadLetterOperatorCounts`: `{ open, acknowledged }`.
- `data.recentFailures`: `{ since, total, retryable, nonRetryable, unknown, byReasonCode, windowHours }`.

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`

## `GET /dead-letters`

Query:
- `status` optional enum: `retryable_failed | dead_failed | failed`
- `reason` optional string filter (case-insensitive)
- `limit` optional integer `1..100`, default `50`

Success `200`:
- `data` array of dead-letter summary objects:
  - `jobId`, `noteId`, `status`, `operatorStatus`, `reasonCode`, `attempts`, `replayOfJobId`, `replayedJobId`, `updatedAt`

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`

## `GET /dead-letters/:id`

Path:
- `id` UUID

Success `200`:
- `data.deadLetter` (same summary shape as list item)
- `data.lastError`
- `data.attempts[]` with fields `attempt`, `fromStatus`, `toStatus`, `error`, `reasonCode`, `occurredAt`
- `data.replayLinkage` with `replayOfJobId`, `replayedJobId`

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`
- `404 DEAD_LETTER_NOT_FOUND`

## `GET /dead-letters/:id/history`

Path:
- `id` UUID

Success `200`:
- `data.deadLetter` dead-letter summary
- `data.replayLinkage`:
  - `originalJobId`, `isReplay`, `hasReplay`, `replayOfJobId`, `replayedJobId`, `replayJobStatus`
- `data.timeline[]`:
  - `eventId`, `eventType`, `actor`, `payload`, `createdAt`

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`
- `404 DEAD_LETTER_NOT_FOUND`

## `GET /dead-letters/:id/replay-status`

Path:
- `id` UUID

Purpose:
- Convenience linkage endpoint for operator consoles to fetch replay state without timeline payload.

Success `200`:
- `data.deadLetter` dead-letter summary
- `data.replayLinkage`:
  - `originalJobId`, `isReplay`, `hasReplay`, `replayOfJobId`, `replayedJobId`, `replayJobStatus`

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`
- `404 DEAD_LETTER_NOT_FOUND`

## `POST /dead-letters/:id/replay`

Path:
- `id` UUID

Success `200`:
- `data.originalJob` operator-safe writeback job view
- `data.replayJob` operator-safe writeback job view
- Operator-safe writeback job view fields:
  - `jobId`, `noteId`, `ehr`, `status`, `attempts`, `operatorStatus`, `lastError`, `reasonCode`, `replayOfJobId`, `replayedJobId`, `createdAt`, `updatedAt`

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`
- `404 DEAD_LETTER_NOT_FOUND`
- `409 DEAD_LETTER_REPLAY_REQUIRES_DEAD_FAILED`
- `409 WRITEBACK_REPLAY_ALREADY_EXISTS`
- `409 WRITEBACK_PRECONDITION_FAILED`
- `409 ILLEGAL_NOTE_STATE_TRANSITION`

## `POST /dead-letters/:id/acknowledge`

Path:
- `id` UUID

Success `200`:
- `data` operator-safe writeback job view (same shape as replay endpoint job objects)

Errors:
- `401 UNAUTHORIZED`
- `400 VALIDATION_ERROR`
- `404 DEAD_LETTER_NOT_FOUND`
- `409 DEAD_LETTER_ALREADY_ACKNOWLEDGED`

## Operator Payload Sanitization Contract

Operator endpoint responses must not expose:
- `idempotencyKey`
- raw `lastErrorDetail`
- raw `attemptHistory`

Sensitive keys in nested payloads/timeline are redacted by server-side redaction policy.
