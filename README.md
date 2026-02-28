# OmniscribeAI1

MVP backend skeleton for transcript ingest, fact ledger, note composition, validation gate, and EHR writeback queue initiation.

## Requirements
- Node.js 22+
- Docker (optional for Postgres/Redis)

## Setup
```bash
npm install
cp .env.example .env
```

Set `API_KEY` in `.env` for non-development environments. In `NODE_ENV=development`, requests are allowed without `API_KEY` and the server logs a warning.

## Run (dev)
```bash
npm run dev
```

Runtime fallback behavior:
- If `DATABASE_URL` is unset, the app starts with in-memory repositories (non-persistent).
- If `REDIS_URL` is unset, fact extraction runs in-process immediately (no BullMQ).
- If `REDIS_URL` is set but unavailable during enqueue, ingest falls back to the same in-memory immediate extraction path.

## Build + start
```bash
npm run build
npm run start
```

## Test
```bash
npm run test
```

## Local smoke E2E
```bash
npm run smoke:e2e
```

This runs `transcript-ingest -> note-compose -> validation-gate -> writeback/jobs -> writeback/jobs/:jobId` and prints `PASS` or `FAIL`.

## Docker services
```bash
docker compose up -d
```

## API auth
All mutation endpoints require `X-API-Key` when `API_KEY` is configured:
- `POST /api/v1/transcript-ingest`
- `POST /api/v1/note-compose`
- `POST /api/v1/validation-gate`
- `POST /api/v1/writeback/jobs`
- `POST /api/v1/writeback/jobs/:jobId/transition`

Sample:
```bash
curl -X POST http://localhost:3000/api/v1/note-compose \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your-api-key' \
  -d '{"sessionId":"sess-1","division":"medical","noteFamily":"progress_note","useExistingFacts":true}'
```

## API endpoints
- `GET /health`
- `POST /api/v1/transcript-ingest`
- `POST /api/v1/fact-ledger/extract`
- `POST /api/v1/note-compose`
- `POST /api/v1/validation-gate`
- `POST /api/v1/writeback/jobs`
- `POST /api/v1/writeback/jobs/:jobId/transition`
