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

## Build + start
```bash
npm run build
npm run start
```

## Test
```bash
npm run test
```

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
  -d '{"sessionId":"sess-1","division":"medical","noteFamily":"progress_note"}'
```

## API endpoints
- `GET /health`
- `POST /api/v1/transcript-ingest`
- `POST /api/v1/fact-ledger/extract`
- `POST /api/v1/note-compose`
- `POST /api/v1/validation-gate`
- `POST /api/v1/writeback/jobs`
- `POST /api/v1/writeback/jobs/:jobId/transition`
