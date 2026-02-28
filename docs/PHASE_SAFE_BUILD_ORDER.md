# Phase-Safe Build Order (Minimize Regression Risk)

## Principle
Ship highest-value core with smallest surface area first; defer cross-cutting complexity until core is stable.

## Phase 1 — Stabilize Core Contracts (low blast radius)
- Lock API schemas and state machine contracts:
  - transcript-ingest
  - note-compose
  - validation-gate
  - writeback transition graph
- Add contract tests + snapshots for error codes and envelopes.
- Exit criteria:
  - 100% existing tests passing
  - contract tests added for all core endpoints

## Phase 2 — Evidence-Backed Engine (controlled feature expansion)
- Implement/extend fact extraction + verification ledger behavior.
- Keep output deterministic behind feature flag where possible.
- Exit criteria:
  - unsupported statement rate gate wired in tests/evals
  - no regressions in Phase 1 endpoints

## Phase 3 — Writeback Assurance Hardening
- Expand dead-letter replay/ack tooling and operator observability.
- Introduce stricter retry/backoff and reason-code handling.
- Exit criteria:
  - replay race tests pass
  - operator contract consistency tests pass

## Phase 4 — Integration Layer (single connector first)
- Implement one production-grade connector path (NextGen first).
- Keep others behind adapter interfaces without full rollout.
- Exit criteria:
  - connector integration tests pass
  - fallback/manual workflow documented

## Phase 5 — Security + Reliability Hardening
- Tighten RBAC/auth boundaries, audit trail integrity, redaction coverage.
- Add canary SLO alerts and rollback automation.
- Exit criteria:
  - security checklist complete
  - canary rollback tested at least once

## Phase 6 — UX/Workflow Expansion + Scale
- Broader modules (analytics, import/migration, enterprise governance) only after core SLOs stable.
- Exit criteria:
  - no core SLO regressions for 2 release cycles
  - backlog priority review approved

---

## Change management rules per phase
- One risky subsystem per PR.
- Use feature flags for behavior-changing logic.
- Require regression checklist completion in PR template.
- No phase jumping without prior phase exit criteria met.
