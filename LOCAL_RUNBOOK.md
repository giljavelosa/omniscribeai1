# Local Runbook: coded, tested, running

This runbook gets OmniscribeAI1 from a clean checkout to a running local API, with a practical end-to-end smoke flow.

## 1) Required environment variables

Copy the template and set local values:

```bash
cp .env.example .env
```

Use these values for local dev:

```dotenv
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/omniscribe
REDIS_URL=redis://localhost:6379
```

Notes:
- `DATABASE_URL` is required for persistent Postgres-backed repositories and migrations.
- `REDIS_URL` enables BullMQ-backed fact extraction queueing. If omitted, queue falls back to in-memory.

## 2) Bring up Postgres + Redis (Docker Compose)

### Preferred (npm helper)
```bash
npm run infra:up
```

### Direct compose
```bash
docker compose up -d db redis
```

Verify containers:
```bash
docker compose ps
```

Tail logs if needed:
```bash
npm run infra:logs
# or: docker compose logs -f db redis
```

## 3) Install deps + run migrations

```bash
npm install
npm run migrate
```

Expected output on first run:
- `Applied migrations: 0001_initial.sql` (or similar)

On repeat runs:
- `No new migrations.`

## 4) Start the API

### Recommended dev mode
```bash
npm run dev
```

API will listen on `http://localhost:3000` by default.

Quick health check:
```bash
curl -s http://localhost:3000/health
```

## 5) End-to-end smoke curl sequence

Open a second terminal while API is running.

```bash
BASE_URL=http://localhost:3000
SESSION_ID=sess-local-001
IDEMPOTENCY_KEY=idem-local-001

# 1) ingest
curl -s -X POST "$BASE_URL/api/v1/transcript-ingest" \
  -H 'content-type: application/json' \
  -d '{
    "sessionId": "'"$SESSION_ID"'",
    "division": "medical",
    "segments": [
      {
        "segmentId": "seg-1",
        "speaker": "clinician",
        "startMs": 0,
        "endMs": 5000,
        "text": "Patient reports cough for three days."
      },
      {
        "segmentId": "seg-2",
        "speaker": "patient",
        "startMs": 5001,
        "endMs": 9000,
        "text": "No fever and no shortness of breath."
      }
    ]
  }'

# 2) compose (capture noteId)
COMPOSE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/note-compose" \
  -H 'content-type: application/json' \
  -d '{
    "sessionId": "'"$SESSION_ID"'",
    "division": "medical",
    "noteFamily": "progress"
  }')

echo "$COMPOSE_RESPONSE"
NOTE_ID=$(echo "$COMPOSE_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).data.noteId));')

# 3) validate (medical + low unsupported rate => approved_for_writeback)
curl -s -X POST "$BASE_URL/api/v1/validation-gate" \
  -H 'content-type: application/json' \
  -d '{
    "noteId": "'"$NOTE_ID"'",
    "unsupportedStatementRate": 0.02
  }'

# 4) writeback create (capture jobId)
WRITEBACK_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/writeback/jobs" \
  -H 'content-type: application/json' \
  -d '{
    "noteId": "'"$NOTE_ID"'",
    "ehr": "nextgen",
    "idempotencyKey": "'"$IDEMPOTENCY_KEY"'"
  }')

echo "$WRITEBACK_RESPONSE"
JOB_ID=$(echo "$WRITEBACK_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).data.jobId));')

# 5) status fetch (writeback job)
curl -s "$BASE_URL/api/v1/writeback/jobs/$JOB_ID"

# Optional: session status
curl -s "$BASE_URL/api/v1/sessions/$SESSION_ID/status"
```

Expected outcome:
- ingest returns `ok: true`
- compose returns note with `status: "draft_created"`
- validation returns `decision: "approved_for_writeback"`
- writeback create returns job with `status: "queued"`
- status fetch returns that same queued job

## 6) Optional helper: one-command local bring-up

```bash
npm run local:up
```

This runs:
1. `npm run infra:up`
2. `npm run migrate`
3. `npm run dev`

## 7) Troubleshooting

### Port conflicts (3000 / 5432 / 6379)
- Update `PORT` in `.env` for API.
- Stop local conflicting services or remap Docker ports in `docker-compose.yml`.

### `No DATABASE_URL configured; skipping migrations.`
- Ensure `.env` exists and `DATABASE_URL` is set.
- Restart shell/API after editing `.env`.

### Redis/BullMQ connection errors
- Confirm `REDIS_URL=redis://localhost:6379`.
- Check Redis container is healthy: `docker compose ps`.

### Migration/connectivity failures
- Wait for Postgres readiness, then rerun:
  ```bash
  npm run migrate
  ```
- Check DB logs:
  ```bash
  docker compose logs db
  ```

### Writeback 409 precondition failure
- Ensure validation was run for the same `noteId`.
- Ensure validation decision is `approved_for_writeback` (for medical/rehab, use low unsupported rate like `0.02`).
- Ensure `ehr` is `nextgen` (other values are rejected in this sprint).

### Clean reset
```bash
npm run infra:down
# if you need to wipe DB volume too:
docker compose down -v
npm run infra:up
npm run migrate
```
