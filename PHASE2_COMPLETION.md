# Phase 2 Completion Summary

## Scope done

- Finalized **Phase 2 Block 6** operator documentation.
- Updated `FINAL_CHECKLIST.md` with final operator flow and full endpoint map.
- Updated `DEADLETTER_RUNBOOK.md` with authoritative triage/ack/replay flow, endpoint map, error mapping, and verification sequence.

## How to run

```bash
npm install
npm run build
npm run test
npm run dev
```

Optional persistent mode:

```bash
npm run infra:up
npm run migrate
npm run dev
```

## Verification commands

```bash
npm run smoke:e2e
curl -s http://localhost:3000/health
curl -s "http://localhost:3000/api/v1/operator/writeback/status/summary?recentHours=24" -H "X-API-Key: $API_KEY"
curl -s "http://localhost:3000/api/v1/operator/writeback/dead-letters?limit=50" -H "X-API-Key: $API_KEY"
```

Replay verification:

```bash
curl -s -X POST "http://localhost:3000/api/v1/operator/writeback/dead-letters/$JOB_ID/replay" -H "X-API-Key: $API_KEY"
curl -s "http://localhost:3000/api/v1/operator/writeback/jobs/$NEW_JOB_ID" -H "X-API-Key: $API_KEY"
```

## Known limits

- In-memory mode (no `DATABASE_URL`/`REDIS_URL`) is non-persistent and not production-safe.
- Replay is guarded by note-state transitions; some dead letters correctly reject replay with `ILLEGAL_NOTE_STATE_TRANSITION`.
- Operator API protections depend on correct `API_KEY` distribution/rotation outside this repo.
