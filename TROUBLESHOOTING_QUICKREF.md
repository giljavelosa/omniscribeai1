# Troubleshooting Quick Reference (Phase 1 Block 6)

## 1) API won’t start

- Check for port conflict on `3000`.
- Try: `lsof -i :3000`
- Override port for run: `PORT=3001 npm run dev`

## 2) Migration skipped (`No DATABASE_URL configured; skipping migrations.`)

- Expected in in-memory mode.
- For DB mode, set `DATABASE_URL` in `.env`, then rerun:
  - `npm run migrate`

## 3) Postgres/Redis connection errors

- Start infra:
  - `npm run infra:up`
- Verify health:
  - `docker compose ps`
  - `npm run infra:logs`
- Retry migration after DB is ready:
  - `npm run migrate`

## 4) Redis unavailable during ingest

- App should fallback to in-memory fact extraction.
- Confirm `REDIS_URL` and Redis container status.
- Check API logs for enqueue/fallback messages.

## 5) Smoke E2E fails

- Ensure API is running first.
- Re-run with explicit URL/API key if needed:
  - `BASE_URL=http://localhost:3000 API_KEY=<value> npm run smoke:e2e`
- Common failure causes:
  - Missing/invalid `X-API-Key` when `API_KEY` is configured
  - Validation decision not `approved_for_writeback`
  - Writeback attempted before successful validation

## 6) Validation/writeback precondition failures

- Re-run sequence in order:
  1. ingest
  2. compose
  3. validation (`unsupportedStatementRate` low, e.g. `0.02`)
  4. writeback create

## 7) Clean reset (local)

```bash
npm run infra:down
docker compose down -v
npm install
npm run infra:up
npm run migrate
```

## 8) Fast readiness verifier

Run:

```bash
bash scripts/phase1-verify.sh
```

This validates build + tests and (optionally) smoke if API is reachable.
