# Dead-Letter Runbook (Phase 2 / Block 3)

Operator playbook for investigating and replaying `dead_failed` writeback jobs.

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

## 2) Triage flow

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
curl -s "$BASE_URL/api/v1/writeback/jobs?state=dead_failed&limit=50" \
  -H "X-API-Key: $API_KEY"
```

Use this list to pick a target `jobId` and `noteId`.

### Step C — Inspect dead-letter job detail + timeline

Use the operator detail endpoint to see attempts and reason codes:

```bash
JOB_ID=<dead_failed_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/jobs/$JOB_ID" \
  -H "X-API-Key: $API_KEY"
```

Review:
- `data.job.status` (should be `dead_failed`)
- `data.attempts[*].reasonCode`
- `data.job.lastError` / `data.job.lastErrorDetail`
- `data.timeline` for transition history

### Step D — Confirm replay eligibility

Before replaying:
1. Verify failure cause is understood and addressed (EHR outage resolved, payload issue fixed upstream, etc.).
2. Confirm this replay will not create duplicate downstream records.
3. Confirm note is still appropriate for writeback.

---

## 3) Replay procedure

### Important behavior

`dead_failed` jobs are terminal and cannot be transitioned back to `queued`.
Replay is done by creating a **new** writeback job for the same note with a **new idempotency key**.

### Step A — Create replay job

```bash
NOTE_ID=<note_id_from_dead_job>
REPLAY_IDEMPOTENCY_KEY=replay-$(date +%s)-$NOTE_ID

curl -s -X POST "$BASE_URL/api/v1/writeback/jobs" \
  -H 'content-type: application/json' \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "noteId": "'"$NOTE_ID"'",
    "ehr": "nextgen",
    "idempotencyKey": "'"$REPLAY_IDEMPOTENCY_KEY"'"
  }'
```

Expected result:
- `ok: true`
- new `data.jobId`
- `data.status: "queued"`

### Step B — Verify replay job detail

```bash
NEW_JOB_ID=<new_job_id>

curl -s "$BASE_URL/api/v1/operator/writeback/jobs/$NEW_JOB_ID" \
  -H "X-API-Key: $API_KEY"
```

### Step C — Track queue health after replay

```bash
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=1" \
  -H "X-API-Key: $API_KEY"
```

---

## 4) Safety cautions

- **Never reuse idempotency keys** across distinct replay attempts.
- **Do not bulk replay blindly** when reason code indicates systemic failure (for example persistent auth or endpoint outages).
- **Rate-limit operational replays** to avoid retry storms against downstream EHR.
- **Preserve auditability**: record incident/ticket ID and operator context for each replay batch.
- **PHI caution**: avoid copying raw sensitive note content into tickets or chat; use identifiers and redacted details only.

---

## 5) Rollback notes

If replay causes adverse effects:

1. **Stop further replays immediately** (operational freeze).
2. Identify replayed jobs using the new idempotency-key pattern and inspect details:
   - `GET /api/v1/writeback/jobs?state=queued|in_progress|retryable_failed|succeeded`
   - `GET /api/v1/operator/writeback/jobs/:jobId`
3. Coordinate with downstream EHR owners for any external corrective action (duplicates/retractions).
4. Revert upstream/root-cause fix if needed before resuming replay.
5. Re-run summary checks (`recentHours=1` and `recentHours=24`) to confirm stabilization.

> Current implementation does not provide a cancel endpoint for already-created jobs; rollback is operational (stop/review/contain) plus downstream remediation.

---

## 6) Quick command bundle

```bash
# summary (24h)
curl -s "$BASE_URL/api/v1/operator/writeback/status/summary?recentHours=24" -H "X-API-Key: $API_KEY"

# dead-letter list
curl -s "$BASE_URL/api/v1/writeback/jobs?state=dead_failed&limit=50" -H "X-API-Key: $API_KEY"

# dead-letter detail
curl -s "$BASE_URL/api/v1/operator/writeback/jobs/$JOB_ID" -H "X-API-Key: $API_KEY"

# replay create
curl -s -X POST "$BASE_URL/api/v1/writeback/jobs" \
  -H 'content-type: application/json' \
  -H "X-API-Key: $API_KEY" \
  -d '{"noteId":"'"$NOTE_ID"'","ehr":"nextgen","idempotencyKey":"'"$REPLAY_IDEMPOTENCY_KEY"'"}'
```
