# CI Regression Gates (Fail/Pass Policy)

These are mandatory merge gates for `main`.

## A. Pipeline gates
1. **Lint gate**
   - Command: `npm run lint`
   - Fail if any lint errors.

2. **Unit/integration gate**
   - Command: `npm test`
   - Fail if any test fails.

3. **Critical smoke gate**
   - Command: `npm run smoke:e2e`
   - Fail if smoke script reports FAIL.

4. **Contract stability gate**
   - Gate: no undocumented API contract change.
   - Fail if endpoint shape/status code changed without changelog + approval label.

## B. Threshold gates (initial targets)
- Test pass rate: **100%** (no flakes allowed in protected branch)
- Branch coverage floor (changed files): **>= 80%**
- Critical path tests required: transcript-ingest, note-compose, validation-gate, writeback, operator dead-letter

## C. Security/compliance gates
- API auth boundaries preserved on mutation/operator routes
- Redaction tests pass (`redaction.test.ts`)
- No secrets in repo scan (`.env`, keys, tokens)

## D. Reliability gates
- Fallback runtime tests pass (DB/Redis unavailable behavior)
- Error envelope consistency tests pass
- Writeback transition legality tests pass

## E. Release gate (pre-deploy)
- `main` must have green CI for latest commit
- Canary deployment required
- Auto rollback if either occurs in canary window:
  - 5xx error rate > 2%
  - `/health` failures in 2 consecutive checks
  - writeback transition failures exceed baseline by > 50%

---

## Suggested GitHub branch protection
- Require PR review: 1+
- Require status checks: lint, test, smoke-e2e, contract-check
- Dismiss stale approvals on new commits: enabled
- Require linear history: enabled
- Restrict direct pushes to `main`: enabled
