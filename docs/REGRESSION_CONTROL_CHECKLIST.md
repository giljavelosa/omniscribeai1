# Regression Control Checklist (OmniScribeAI)

Use this checklist on **every PR**.

## 0) Scope control
- [ ] PR is single-purpose and module-scoped (avoid mixed concerns)
- [ ] API contract changes are explicitly called out in PR description
- [ ] If request/response schema changed, versioning/migration note is included

## 1) Pre-merge quality gates (must pass)
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run smoke:e2e`
- [ ] No snapshot/schema drift without reviewer approval
- [ ] No new `TODO/FIXME` in changed files unless ticket-linked

## 2) Critical path verification (manual/automated)
- [ ] Transcript ingest: valid payload accepted; invalid payload rejected with stable error code
- [ ] Note compose: deterministic structure present; division mismatch handling preserved
- [ ] Validation gate: decision thresholds preserved; invalid transitions blocked
- [ ] Writeback: idempotency key behavior preserved; transitions enforce legal state graph
- [ ] Dead-letter flow: replay/acknowledge constraints preserved; duplicate replay blocked

## 3) Security and PHI controls
- [ ] API key boundaries preserved on mutation/operator endpoints
- [ ] Redaction behavior preserved for sensitive keys in logs/responses
- [ ] No plaintext secrets added to code, docs, fixtures, or `.env.example`

## 4) Reliability safeguards
- [ ] Fallback behavior unchanged (DB/Redis unavailable paths still function)
- [ ] Error envelope format remains stable
- [ ] Correlation ID propagation intact in request logs

## 5) Release safety
- [ ] Canary deployment plan attached to PR
- [ ] Rollback command/path documented in PR
- [ ] Post-deploy validation checklist attached (health + core endpoints)

---

## PR template snippet (copy/paste)
```md
### Regression Guardrail Checks
- [ ] Lint/Test/Smoke passed
- [ ] Critical path checks passed
- [ ] API contract unchanged (or versioned + migration note added)
- [ ] PHI redaction/security checks passed
- [ ] Canary + rollback plan included
```
