#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${GITHUB_BASE_REF:-}"

if [[ -z "$BASE_REF" ]]; then
  echo "No GITHUB_BASE_REF (likely push to main). Skipping strict contract diff check."
  exit 0
fi

echo "Running contract check against base ref: $BASE_REF"
git fetch --no-tags --depth=1 origin "$BASE_REF"

CHANGED_FILES=$(git diff --name-only "origin/$BASE_REF...HEAD")

echo "Changed files:"
echo "$CHANGED_FILES"

CONTRACT_TOUCH_REGEX='^(src/modules/.*/index.ts|src/app.ts|src/lib/apiError.ts|src/plugins/errorEnvelope.ts)$'
CONTRACT_DOC='docs/API_CONTRACT_CHANGES.md'

CONTRACT_CHANGED=false
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" =~ $CONTRACT_TOUCH_REGEX ]]; then
    CONTRACT_CHANGED=true
    break
  fi
done <<< "$CHANGED_FILES"

if [[ "$CONTRACT_CHANGED" == "false" ]]; then
  echo "No contract-surface files changed. PASS"
  exit 0
fi

echo "Contract-surface files changed. Checking for contract changelog update..."
if echo "$CHANGED_FILES" | grep -qx "$CONTRACT_DOC"; then
  echo "Found $CONTRACT_DOC update. PASS"
  exit 0
fi

echo "FAIL: Contract-surface files changed, but $CONTRACT_DOC was not updated."
echo "Add migration notes/status-code/request-response diffs to $CONTRACT_DOC"
exit 1
