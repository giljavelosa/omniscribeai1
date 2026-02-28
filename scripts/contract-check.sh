#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${GITHUB_BASE_REF:-}"

if [[ -z "$BASE_REF" ]]; then
  echo "No GITHUB_BASE_REF (likely push to main). Skipping strict contract diff check."
  exit 0
fi

echo "Running contract check against base ref: $BASE_REF"
BASE_REMOTE_REF="origin/$BASE_REF"
BASE_FETCH_REFSPEC="refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF"

echo "Fetching base branch ref: $BASE_FETCH_REFSPEC"
git fetch --no-tags --depth=1 origin "$BASE_FETCH_REFSPEC"

resolve_merge_base() {
  local merge_base=""
  if merge_base=$(git merge-base HEAD "$BASE_REMOTE_REF" 2>/dev/null); then
    echo "$merge_base"
    return 0
  fi

  for deepen_by in 32 128 512; do
    echo "Merge base not found yet; deepening clone by $deepen_by..." >&2
    git fetch --no-tags --deepen="$deepen_by" origin "$BASE_FETCH_REFSPEC"
    if merge_base=$(git merge-base HEAD "$BASE_REMOTE_REF" 2>/dev/null); then
      echo "$merge_base"
      return 0
    fi
  done

  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    echo "Merge base still not found; unshallowing repository..." >&2
    git fetch --no-tags --unshallow origin || git fetch --no-tags --depth=0 origin
    if merge_base=$(git merge-base HEAD "$BASE_REMOTE_REF" 2>/dev/null); then
      echo "$merge_base"
      return 0
    fi
  fi

  return 1
}

if MERGE_BASE=$(resolve_merge_base); then
  DIFF_RANGE="$MERGE_BASE..HEAD"
else
  echo "WARN: Unable to compute merge-base; falling back to $BASE_REMOTE_REF..HEAD diff."
  DIFF_RANGE="$BASE_REMOTE_REF..HEAD"
fi

CHANGED_FILES=$(git diff --name-only "$DIFF_RANGE")

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
