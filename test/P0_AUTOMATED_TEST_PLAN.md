# P0 Automated Test Plan

## Scope
Covers highest-risk API safety behavior for ingest, validation gate, writeback, and state-flow controls.

## Test Cases

1. No silent failure on malformed ingest payload
- Endpoint: `POST /api/v1/transcript-ingest`
- Priority: P0
- Automation status: Runnable now
- Assertion:
  - malformed payload returns non-2xx (`4xx` or `5xx`)
  - response includes structured error payload (`statusCode`, `error`, `message`)
- Implemented in: `test/p0-critical-path.test.ts`

2. BH risk gate hard stop
- Endpoint target: expected validation/risk gate endpoint for BH division
- Priority: P0
- Automation status: Expected-blocked placeholder (endpoint/contract behavior not implemented yet)
- Assertion target:
  - BH payload above risk threshold must hard-stop with explicit blocked status and reason
- Placeholder in: `test/p0-critical-path.test.ts` (`it.todo`)

3. Writeback idempotency precondition behavior
- Endpoint: `POST /api/v1/writeback/jobs`
- Priority: P0
- Automation status:
  - Runnable now for baseline precondition contract rejection
  - Expected-blocked placeholder for full idempotency semantics
- Assertion now:
  - missing required precondition fields is rejected with structured error
- Assertion pending:
  - duplicate idempotency key/precondition does not create duplicate queued job
- Implemented in: `test/p0-critical-path.test.ts` (one runnable + one `it.todo`)

4. Illegal state transition rejection
- Endpoint target: expected state-transition workflow endpoint
- Priority: P0
- Automation status: Expected-blocked placeholder (state machine transition endpoint/contract not implemented yet)
- Assertion target:
  - disallowed state transition is rejected with explicit reason code
- Placeholder in: `test/p0-critical-path.test.ts` (`it.todo`)

## Runnable now
- `test/p0-critical-path.test.ts`
  - malformed ingest rejection test
  - writeback precondition rejection test

## Pending implementation
- BH risk hard-stop behavior + endpoint contract
- writeback idempotency de-dup semantics
- explicit state transition API and rejection contract
