# Phase 1 Block 6 — Final Readiness Checklist (Local Pilot)

Use this checklist as a strict **go / no-go** gate before running a local pilot.

## A) Preconditions

- [ ] Node.js is v22+ (`node -v`)
- [ ] Docker is installed and running (for DB/Redis mode)
- [ ] Repo is clean enough for pilot (`git status` reviewed)
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` exists (`cp .env.example .env` if missing)

## B) Build + Quality Gates

- [ ] TypeScript build passes: `npm run build`
- [ ] Test suite passes: `npm run test`
- [ ] Smoke E2E passes against running API: `npm run smoke:e2e`

## C) Runtime Mode Decision

Choose **one** mode for pilot execution.

### Option 1 — In-memory fallback mode (no Postgres/Redis)

- [ ] `DATABASE_URL` is unset/empty for this run
- [ ] `REDIS_URL` is unset/empty for this run
- [ ] API starts successfully
- [ ] `/health` responds OK

### Option 2 — DB + Redis mode (persistent + queue)

- [ ] Infra containers healthy: Postgres + Redis
- [ ] Migrations completed (`npm run migrate`)
- [ ] API starts successfully
- [ ] `/health` responds OK

## D) Functional Pilot Flow (Required)

- [ ] `transcript-ingest` returns `ok: true`
- [ ] `note-compose` returns `data.noteId` and `status: draft_created`
- [ ] `validation-gate` returns `approved_for_writeback`
- [ ] `writeback/jobs` returns job with `status: queued`
- [ ] `writeback/jobs/:jobId` returns same queued job record

## E) Security / Access Baseline

- [ ] If `API_KEY` is configured, all mutation calls include `X-API-Key`
- [ ] No production secrets are committed in repo files
- [ ] Logs show no fatal startup or connection errors

## F) Go / No-Go Decision

**GO** only if all required boxes above are checked.

- Go decision: [ ] GO  [ ] NO-GO
- Operator:
- Date/Time:
- Notes / blockers:

## One-command run sequences

### 1) In-memory fallback run (single command)

```bash
(env -u DATABASE_URL -u REDIS_URL npm run build && env -u DATABASE_URL -u REDIS_URL npm run test && env -u DATABASE_URL -u REDIS_URL npm run dev)
```

### 2) DB + Redis run (single command)

```bash
(npm run infra:up && npm run migrate && npm run build && npm run test && npm run dev)
```

> In another terminal, execute smoke test after API is up:
>
> ```bash
> npm run smoke:e2e
> ```
