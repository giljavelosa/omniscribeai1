## Summary
- What changed?
- Why?

## Scope
- [ ] Single-purpose, module-scoped change
- [ ] No mixed unrelated refactors

## Regression Guardrail Checks
- [ ] `npm run lint` passed
- [ ] `npm test` passed
- [ ] `npm run smoke:e2e` passed
- [ ] Critical path checks passed (ingest/compose/validate/writeback/dead-letter)
- [ ] API contract unchanged (or versioned + migration note added)
- [ ] PHI redaction/security checks passed
- [ ] Canary + rollback plan included

## API / Contract Impact
- [ ] No API request/response changes
- [ ] API changed and documented below

### If API changed, include:
- Endpoints affected:
- Request/response diff:
- Error code/status changes:
- Migration/versioning notes:

## Risk & Rollout
- Risk level: Low / Medium / High
- Rollout plan:
- Rollback plan:

## Evidence
- Test output snippets / screenshots / logs:
