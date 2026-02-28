# Phase 2 Block 6 — Final Operator Readiness Checklist

Use this checklist as the final **go / no-go** gate for Phase 2 operations.

---

## A) Preconditions

- [ ] Node.js is v22+ (`node -v`)
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` exists (`cp .env.example .env` if missing)
- [ ] `API_KEY` set for operator/protected endpoint access
- [ ] If running persistent mode, Docker is running and infra is healthy (`npm run infra:up`)

---

## B) Build + Quality Gates

- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm run test`)
- [ ] Smoke flow passes (`npm run smoke:e2e`)

---

## C) Phase 2 Final Operator Flow (required)

Run in this exact order for daily operations and incident handling:

1. **Baseline health**: `GET /health`
2. **Pipeline summary**: `GET /api/v1/operator/writeback/status/summary?recentHours=24`
3. **Dead-letter list**: `GET /api/v1/operator/writeback/dead-letters?limit=50`
4. For each target job:
   - `GET /api/v1/operator/writeback/dead-letters/:id`
   - `GET /api/v1/operator/writeback/dead-letters/:id/history`
5. **Decision point**:
   - acknowledge known issue: `POST /api/v1/operator/writeback/dead-letters/:id/acknowledge`
   - replay after fix validated: `POST /api/v1/operator/writeback/dead-letters/:id/replay`
6. **Replay verification**:
   - `GET /api/v1/operator/writeback/jobs/:jobId`
   - `GET /api/v1/operator/writeback/status/summary?recentHours=1`

Checklist gates:
- [ ] Any dead-letter job was triaged (detail + history checked)
- [ ] Every action was either acknowledged with reason or replayed with verification
- [ ] No unauthorized or validation errors in normal operator path

---

## D) Endpoint Map (Phase 2 final)

### Core flow endpoints

- `GET /health`
- `POST /api/v1/transcript-ingest`
- `POST /api/v1/fact-ledger/extract`
- `POST /api/v1/note-compose`
- `POST /api/v1/validation-gate`
- `POST /api/v1/writeback/jobs`
- `POST /api/v1/writeback/jobs/:jobId/transition`

### Operator endpoints

- `GET /api/v1/operator/writeback/status/summary`
- `GET /api/v1/operator/writeback/dead-letters`
- `GET /api/v1/operator/writeback/dead-letters/:id`
- `GET /api/v1/operator/writeback/dead-letters/:id/history`
- `POST /api/v1/operator/writeback/dead-letters/:id/acknowledge`
- `POST /api/v1/operator/writeback/dead-letters/:id/replay`
- `GET /api/v1/operator/writeback/jobs/:jobId`

---

## E) Security / Access Baseline

- [ ] Protected calls include `X-API-Key` when `API_KEY` is configured
- [ ] No secrets committed in repository
- [ ] Logs show no fatal startup/connection failures
- [ ] Operator actions are tied to ticket/incident IDs

---

## F) Go / No-Go Decision

**GO** only if all required boxes above are checked.

- Go decision: [ ] GO  [ ] NO-GO
- Operator:
- Date/Time:
- Notes / blockers:
