# Dead-Letter Runbook (Phase 2 / Block 6 Final)

Operator playbook for investigating, acknowledging, and replaying dead-letter writeback jobs.

> Scope: Phase 2 operator dead-letter handling and verification. No product behavior changes from this runbook.

---

## 1) Preconditions

```bash
BASE_URL=http://localhost:3000
API_KEY=local-dev-key
```

All endpoints below are under `/api/v1`.

---

## 2) Final Phase 2 operator flow (authoritative)

Follow this sequence exactly:

1. **Health baseline**
   - `GET /health`
2. **Operational summary window**
   - `GET /operator/writeback/status/summary?recentHours=24`
3. **Dead-letter inventory**
   - `GET /operator/writeback/dead-letters?limit=50`
4. **Per-item triage**
   - `GET /operator/writeback/dead-letters/:id`
   - `GET /operator/writeback/dead-letters/:id/history`
   - `GET /operator/writeback/dead-letters/:id/replay-status`
5. **Action decision**
   - Acknowledge: `POST /operator/writeback/dead-letters/:id/acknowledge`
   - Replay: `POST /operator/writeback/dead-letters/:id/replay`
6. **Post-action verification**
   - `GET /operator/writeback/jobs/:jobId`
   - `GET /operator/writeback/status/summary?recentHours=1`

---

## 3) Endpoint map (Phase 2 final)

### Core writeback lifecycle

- `POST /writeback/jobs`
- `POST /writeback/jobs/:jobId/transition`

### Operator dead-letter controls

- `GET /operator/writeback/status/summary`
- `GET /operator/writeback/dead-letters`
- `GET /operator/writeback/dead-letters/:id`
- `GET /operator/writeback/dead-letters/:id/history`
- `GET /operator/writeback/dead-letters/:id/replay-status`
- `POST /operator/writeback/dead-letters/:id/acknowledge`
- `POST /operator/writeback/dead-letters/:id/replay`
- `GET /operator/writeback/jobs/:jobId`

All routes above resolve as `/api/v1/<path>` in requests.

---

## 4) Triage commands

### A) Summary

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=24" \
  -H "X-API-Key: $API_KEY"
```

### B) Dead-letter list

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters?limit=50" \
  -H "X-API-Key: $API_KEY"
```

### C) Dead-letter detail

```bash
JOB_ID=<dead_letter_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID" \
  -H "X-API-Key: $API_KEY"
```

### D) Dead-letter history

```bash
JOB_ID=<dead_letter_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/history" \
  -H "X-API-Key: $API_KEY"
```

### E) Dead-letter replay linkage status

```bash
JOB_ID=<dead_letter_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/replay-status" \
  -H "X-API-Key: $API_KEY"
```

---

## 5) Acknowledge workflow

```bash
JOB_ID=<dead_letter_job_id>

curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/acknowledge" \
  -H "X-API-Key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "reason": "Known issue tracked in incident INC-####; replay deferred"
  }'
```

Expected:
- `ok: true`
- acknowledgment metadata present for the dead-letter item

---

## 6) Replay workflow

```bash
JOB_ID=<dead_letter_job_id>

curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/replay" \
  -H "X-API-Key: $API_KEY"
```

Expected:
- replay creates a **new queued job**
- linkage retained (`replayOfJobId` / `replayedJobId`)

Verify:

```bash
NEW_JOB_ID=<new_replay_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/jobs/$NEW_JOB_ID" \
  -H "X-API-Key: $API_KEY"

curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=1" \
  -H "X-API-Key: $API_KEY"
```

---

## 7) Common error mapping

- `401 UNAUTHORIZED` — missing/invalid API key
- `404 DEAD_LETTER_NOT_FOUND` — job not found or not a dead-letter job
- `409 DEAD_LETTER_REPLAY_REQUIRES_DEAD_FAILED` — replay attempted for non-`dead_failed` item
- `409 WRITEBACK_REPLAY_ALREADY_EXISTS` — replay already linked for this dead-letter item
- `409 DEAD_LETTER_ALREADY_ACKNOWLEDGED` — dead-letter item already acknowledged
- `409 ILLEGAL_NOTE_STATE_TRANSITION` — replay guard prevented unsafe state transition
- `409 WRITEBACK_PRECONDITION_FAILED` — related note/job precondition failed
- `400 VALIDATION_ERROR` — malformed ID/request

---

## 8) Safety rules

- Do not bulk replay during active systemic outages.
- Acknowledge first when root cause is unresolved.
- Rate-limit replay actions to avoid downstream retry storms.
- Tie every acknowledge/replay action to an incident or ticket ID.
- Avoid sharing raw PHI in tickets/chat.

---

## 9) Rapid command bundle

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=24" -H "X-API-Key: $API_KEY"
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters?limit=50" -H "X-API-Key: $API_KEY"
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID" -H "X-API-Key: $API_KEY"
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/history" -H "X-API-Key: $API_KEY"
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/replay-status" -H "X-API-Key: $API_KEY"
curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/acknowledge" -H "X-API-Key: $API_KEY" -H 'content-type: application/json' -d '{"reason":"Deferred pending fix"}'
curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/replay" -H "X-API-Key: $API_KEY"
```
