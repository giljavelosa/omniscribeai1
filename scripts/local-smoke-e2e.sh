#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SESSION_ID="${SESSION_ID:-sess-smoke-$(date +%s)}"
IDEMPOTENCY_KEY="${IDEMPOTENCY_KEY:-idem-smoke-$(date +%s)}"
API_KEY_VALUE="${API_KEY:-}"

CURL_HEADERS=(-H "content-type: application/json")
if [[ -n "$API_KEY_VALUE" ]]; then
  CURL_HEADERS+=(-H "x-api-key: ${API_KEY_VALUE}")
fi

extract_json_field() {
  local path="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);const v='${path}'.split('.').reduce((a,k)=>a?.[k],o);if(v===undefined||v===null){process.exit(2)};console.log(v);});"
}

fail() {
  echo "FAIL: $1"
  exit 1
}

echo "[1/5] transcript-ingest"
INGEST_RESPONSE=$(curl -sS -X POST "$BASE_URL/api/v1/transcript-ingest" "${CURL_HEADERS[@]}" -d "{\"sessionId\":\"$SESSION_ID\",\"division\":\"medical\",\"segments\":[{\"segmentId\":\"seg-1\",\"speaker\":\"clinician\",\"startMs\":0,\"endMs\":1200,\"text\":\"Patient has cough for three days.\"},{\"segmentId\":\"seg-2\",\"speaker\":\"patient\",\"startMs\":1201,\"endMs\":2400,\"text\":\"No fever reported.\"}]}") || fail "ingest request failed"
printf '%s' "$INGEST_RESPONSE" | extract_json_field "ok" >/dev/null || fail "ingest response was not ok"

echo "[2/5] note-compose"
COMPOSE_RESPONSE=$(curl -sS -X POST "$BASE_URL/api/v1/note-compose" "${CURL_HEADERS[@]}" -d "{\"sessionId\":\"$SESSION_ID\",\"division\":\"medical\",\"noteFamily\":\"progress_note\",\"useExistingFacts\":true}") || fail "compose request failed"
NOTE_ID=$(printf '%s' "$COMPOSE_RESPONSE" | extract_json_field "data.noteId") || fail "compose did not return noteId"

echo "[3/5] validation-gate"
VALIDATION_RESPONSE=$(curl -sS -X POST "$BASE_URL/api/v1/validation-gate" "${CURL_HEADERS[@]}" -d "{\"noteId\":\"$NOTE_ID\",\"unsupportedStatementRate\":0.02}") || fail "validation request failed"
DECISION=$(printf '%s' "$VALIDATION_RESPONSE" | extract_json_field "data.decision") || fail "validation did not return decision"
[[ "$DECISION" == "approved_for_writeback" ]] || fail "unexpected validation decision: $DECISION"

echo "[4/5] writeback/jobs"
WRITEBACK_RESPONSE=$(curl -sS -X POST "$BASE_URL/api/v1/writeback/jobs" "${CURL_HEADERS[@]}" -d "{\"noteId\":\"$NOTE_ID\",\"ehr\":\"nextgen\",\"idempotencyKey\":\"$IDEMPOTENCY_KEY\"}") || fail "writeback create request failed"
JOB_ID=$(printf '%s' "$WRITEBACK_RESPONSE" | extract_json_field "data.jobId") || fail "writeback did not return jobId"

echo "[5/5] writeback/jobs/:jobId"
STATUS_RESPONSE=$(curl -sS "$BASE_URL/api/v1/writeback/jobs/$JOB_ID" "${CURL_HEADERS[@]}") || fail "writeback status request failed"
JOB_STATUS=$(printf '%s' "$STATUS_RESPONSE" | extract_json_field "data.status") || fail "status did not return job status"
[[ "$JOB_STATUS" == "queued" ]] || fail "unexpected job status: $JOB_STATUS"

echo "PASS"
