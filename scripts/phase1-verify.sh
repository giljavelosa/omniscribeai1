#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY_VALUE="${API_KEY:-}"

PASS_COUNT=0
FAIL_COUNT=0

run_step() {
  local name="$1"
  shift
  echo
  echo "==> ${name}"
  if "$@"; then
    echo "[PASS] ${name}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] ${name}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return 1
  fi
}

api_up() {
  curl -fsS "${BASE_URL}/health" >/dev/null
}

echo "Phase 1 verify started"
echo "BASE_URL=${BASE_URL}"

run_step "Build (tsc)" npm run build
run_step "Tests (vitest)" npm run test

if api_up; then
  echo
  echo "API health check OK at ${BASE_URL}; running smoke E2E."
  if [[ -n "${API_KEY_VALUE}" ]]; then
    run_step "Smoke E2E" env BASE_URL="${BASE_URL}" API_KEY="${API_KEY_VALUE}" npm run smoke:e2e
  else
    run_step "Smoke E2E" env BASE_URL="${BASE_URL}" npm run smoke:e2e
  fi
else
  echo
  echo "[SKIP] Smoke E2E (API not reachable at ${BASE_URL}/health)"
  echo "       Start API first (e.g., npm run dev), then re-run this script."
fi

echo
if [[ ${FAIL_COUNT} -eq 0 ]]; then
  echo "SUMMARY: PASS (${PASS_COUNT} checks passed, ${FAIL_COUNT} failed)"
  exit 0
else
  echo "SUMMARY: FAIL (${PASS_COUNT} checks passed, ${FAIL_COUNT} failed)"
  exit 1
fi
