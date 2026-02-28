# Security Release Checklist

Use this as a release gate for every production deploy.

## Secrets and Config
- [ ] No plaintext production secrets in repository files, `.env`, or logs.
- [ ] Runtime secrets are sourced from an approved secrets manager.
- [ ] Service account and database credentials are least-privilege.

## Logging and Privacy
- [ ] Request logging redaction is enabled for PHI-like fields and auth headers.
- [ ] Correlation ID is present in responses and error envelopes.
- [ ] Logs do not contain raw access tokens, cookies, SSNs, MRNs, DOB, names, or addresses.

## API Error Handling
- [ ] All API errors return the standard error envelope (`ok`, `error`, `correlationId`).
- [ ] Internal errors return generic client-safe messages.
- [ ] 404 and validation failures follow the same error envelope contract.

## Quality Gates
- [ ] Unit/integration tests pass in CI.
- [ ] Build passes in CI.
- [ ] Dependency scan has no unresolved critical vulnerabilities.
- [ ] Manual smoke check confirms `x-correlation-id` propagation.
