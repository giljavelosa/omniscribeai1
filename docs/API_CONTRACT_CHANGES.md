# API Contract Changes Log

Use this file whenever contract-surface files change:
- `src/modules/**/index.ts`
- `src/app.ts`
- `src/lib/apiError.ts`
- `src/plugins/errorEnvelope.ts`

For each PR, add:
- Date / PR
- Endpoints affected
- Request/response schema changes
- Status code / error code changes
- Migration or compatibility notes

---

## Entries

### 2026-02-28 / Baseline
- Initialized contract change log.
- No contract changes in this entry.

### 2026-02-28 / PR4 (planned) — Operator dead-letter parity
- Endpoints affected:
  - `GET /api/v1/operator/writeback/dead-letters/:id/history`
- Request/response diff:
  - `replayLinkage.replayJobStatus` in history view now resolves from replay job when available (previously always `null`).
- Status code / error code changes:
  - None.
- Compatibility notes:
  - Additive/compatibility-safe change; aligns history payload parity with replay-status endpoint.
