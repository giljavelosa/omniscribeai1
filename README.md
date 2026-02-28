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

## API endpoints
- `GET /health`
- `POST /api/v1/transcript-ingest`
- `POST /api/v1/fact-ledger/extract`
- `POST /api/v1/note-compose`
- `POST /api/v1/validation-gate`
- `POST /api/v1/writeback/jobs`
