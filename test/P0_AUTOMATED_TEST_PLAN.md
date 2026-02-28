# P0 Automated Test Plan

## Scope
Covers highest-risk API safety behavior for ingest, validation gate, writeback, and state-flow controls.

## Test Cases

1. No silent failure on malformed ingest payload
- Endpoint: `POST /api/v1/transcript-ingest`
- Priority: P0
- Automation status: Runnable now
- Assertion:
  - malformed payload returns `400`
  - response includes standardized envelope (`ok=false`, `error.code`, `error.message`, `correlationId`)
- Implemented in: `test/p0-critical-path.test.ts`

2. BH risk gate hard stop
- Endpoint target: expected validation/risk gate endpoint for BH division
- Priority: P0
- Automation status:
  - Runnable now for current BH validation-gate `needs_review` behavior
  - Runnable expected-blocked for missing BH `blocked`/reason-code contract
- Assertion target:
  - current API response for BH returns `needs_review`
  - hard-stop `blocked` status + explicit reason is not yet exposed
- Implemented in: `test/p0-critical-path.test.ts` (two runnable tests)

3. Writeback idempotency precondition behavior
- Endpoint: `POST /api/v1/writeback/jobs`
- Priority: P0
- Automation status:
  - Runnable now for baseline precondition contract rejection
  - Runnable now to capture current EHR gate behavior (`nextgen` + `webpt` accepted)
  - Runnable expected-blocked for full idempotency semantics (no de-dup contract exposed)
- Assertion now:
  - missing required precondition fields is rejected with standardized validation envelope
- Assertion pending:
  - duplicate idempotency key/precondition does not create duplicate queued job
- Implemented in: `test/p0-critical-path.test.ts` (all executable)

4. Illegal state transition rejection
- Endpoint target: `POST /api/v1/writeback/jobs/:jobId/transition`
- Priority: P0
- Automation status: Runnable now
- Assertion target:
  - disallowed transition returns `409`
  - response contains explicit reason code `ILLEGAL_WRITEBACK_STATE_TRANSITION`
- Implemented in: `test/p0-critical-path.test.ts`

## Runnable now
- `test/p0-critical-path.test.ts`
  - malformed ingest rejection test
  - writeback precondition rejection test
  - BH validation-gate current `needs_review` behavior test
  - writeback EHR gate behavior test (`nextgen` + `webpt`)
  - writeback idempotency replay test
  - state-transition rejection contract test (`409` + explicit code)

## Pending implementation
- BH risk hard-stop `blocked` behavior + reason-code contract
- BH risk hard-stop `blocked` reason-code contract
