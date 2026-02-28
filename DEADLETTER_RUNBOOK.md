# Dead-Letter Runbook (Phase 2 / Block 4)

Operator playbook for investigating, acknowledging, and replaying dead-letter writeback jobs.

> Scope: writeback dead-letter handling only. Do **not** change product behavior from this runbook.

---

## 1) Preconditions

Set local variables first:

```bash
BASE_URL=http://localhost:3000
API_KEY=local-dev-key
```

All endpoints below are under `/api/v1`.

---

## 2) Quick daily operator checklist

Run this in order every day:

1. **Summary** — check overall queue/failure shape.
2. **Dead letters** — list and inspect dead-letter items.
3. **Acknowledge or replay** — for each dead letter, either:
   - acknowledge (known/accepted, no immediate replay), or
   - replay (cause fixed and safe to retry).

---

## 3) Triage flow

### Step A — Check overall writeback health summary

Use this first to understand queue/failure shape in the recent window.

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=24" \
  -H "X-API-Key: $API_KEY"
```

Expected signal:
- `data.countsByStatus.dead_failed` > 0 means dead-letter work exists.
- `data.recentFailures.byReasonCode` highlights dominant failure reasons.

### Step B — List dead-letter jobs

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters?limit=50" \
  -H "X-API-Key: $API_KEY"
```

Use this list to pick target `jobId`/`noteId` and reason codes.

### Step C — Inspect dead-letter detail + timeline

```bash
JOB_ID=<dead_letter_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID" \
  -H "X-API-Key: $API_KEY"
```

Review:
- `data.job.status` (`dead_failed`, `retryable_failed`, or `failed`)
- `data.reasonCode`
- `data.attempts[*].reasonCode`
- `data.job.lastError` / `data.job.lastErrorDetail`
- `data.timeline`

---

## 4) Acknowledge workflow

Use acknowledge when the dead-letter item is understood and intentionally not replayed immediately.

### Step A — Acknowledge

```bash
JOB_ID=<dead_letter_job_id>

curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/acknowledge" \
  -H "X-API-Key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "reason": "Known upstream issue; replay deferred until vendor confirms fix"
  }'
```

Expected result:
- `ok: true`
- acknowledged dead-letter payload returned with acknowledgment metadata

### Expected acknowledge errors

- `401 UNAUTHORIZED` — missing/invalid API key.
- `404 DEAD_LETTER_NOT_FOUND` — job ID is unknown or not in dead-letter state.
- `409 WRITEBACK_PRECONDITION_FAILED` — related note/job precondition missing.
- `400 VALIDATION_ERROR` — malformed request body/ID.

---

## 5) Replay workflow

### Important behavior

- Dead-letter jobs are terminal; replay creates a **new queued job**.
- Replay is linked to original (`replayOfJobId` / `replayedJobId`) for auditability.
- Replay includes a guard to prevent unsafe/duplicate replays when note state cannot move to `writeback_queued`.

### Step A — Replay dead letter

```bash
JOB_ID=<dead_letter_job_id>

curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/replay" \
  -H "X-API-Key: $API_KEY"
```

Expected result:
- `ok: true`
- `data.originalJob.replayedJobId` populated
- `data.replayJob.status: "queued"`
- `data.replayJob.idempotencyKey` is a newly generated replay key

### Step B — Verify replay detail

```bash
NEW_JOB_ID=<new_replay_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/jobs/$NEW_JOB_ID" \
  -H "X-API-Key: $API_KEY"
```

### Step C — Track queue health after replay

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=1" \
  -H "X-API-Key: $API_KEY"
```

### Expected replay errors

- `401 UNAUTHORIZED` — missing/invalid API key.
- `404 DEAD_LETTER_NOT_FOUND` — job ID not found or not a dead-letter job.
- `409 ILLEGAL_NOTE_STATE_TRANSITION` — **replay guard triggered** (note state cannot safely transition to `writeback_queued`, including already replayed/in-flight paths).
- `409 WRITEBACK_PRECONDITION_FAILED` — note for dead-letter job is missing.
- `400 VALIDATION_ERROR` — malformed ID/body.

---

## 6) Safety cautions

- **Do not bulk replay blindly** when reason code indicates systemic failure (persistent auth or endpoint outage).
- **Acknowledge first** if root cause is not fixed yet.
- **Rate-limit operator replays** to avoid retry storms against downstream EHR.
- **Preserve auditability**: tie every acknowledge/replay action to incident/ticket ID.
- **PHI caution**: avoid copying raw sensitive note content into tickets/chat; use identifiers and redacted context.

---

## 7) Rollback notes

If replay causes adverse effects:

1. **Stop further replays immediately** (operational freeze).
2. Identify replayed jobs and inspect linked details:
   - `GET /api/v1/operator/writeback/dead-letters/:id`
   - `GET /api/v1/operator/writeback/jobs/:jobId`
3. Coordinate with downstream EHR owners for external remediation (duplicates/retractions).
4. Revert upstream/root-cause fix if needed before resuming replay.
5. Re-run summary checks (`recentHours=1` and `recentHours=24`) to confirm stabilization.

---

## 8) Quick command bundle

```bash
# summary (24h)
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=24" -H "X-API-Key: $API_KEY"

# dead-letter list
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters?limit=50" -H "X-API-Key: $API_KEY"

# dead-letter detail
curl -s "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID" -H "X-API-Key: $API_KEY"

# acknowledge dead-letter
curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/acknowledge" \
  -H "X-API-Key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{"reason":"Deferred pending upstream fix"}'

# replay dead-letter
curl -s -X POST "$BASE_URL/api/v1/operator/writeback/dead-letters/$JOB_ID/replay" \
  -H "X-API-Key: $API_KEY"
```
