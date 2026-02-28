# Phase 3 Architecture Contracts (Concise Reconstruction)

This file was reconstructed from current repository docs (`PHASE_SAFE_BUILD_ORDER.md`, `CI_REGRESSION_GATES.md`, and existing endpoint behavior) to keep PR slicing explicit.

## Goal
Harden API contract stability for the core pipeline with minimal blast radius.

## PR slices

### PR1 — Core API contract lock (this slice)
Scope:
- Add contract tests for core endpoints:
  - `POST /api/v1/transcript-ingest`
  - `POST /api/v1/note-compose`
  - `POST /api/v1/validation-gate`
  - `POST /api/v1/writeback/jobs`
- Verify stable success envelope (`{ ok: true, data: ... }`) and required fields.
- Verify stable error envelope (`{ ok: false, error: { code, message }, correlationId }`) for representative failures.

Out of scope:
- New endpoint behavior
- State-machine changes
- Connector changes

Acceptance:
- Added tests fail when contract shape or error-code behavior drifts.
- Existing behavior preserved.

### PR2 — Deterministic error-code matrix snapshots
- Snapshot allowed error codes/statuses per core endpoint.

### PR3 — Operator/writeback contract parity hardening
- Extend parity assertions across operator/writeback status and dead-letter views.
