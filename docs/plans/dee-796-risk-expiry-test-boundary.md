---
integrationIssue: DEE-796
integrationTitle: "Deterministic PostgreSQL Risk expiry test boundary"
parentIssue: DEE-755
branch: dee-796-risk-expiry-test-boundary
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: ce9a726100aee93ad993b60ee43feae0cb27cbc0
executionSurfaces: [local-postgres, github-pr-ci, linear]
requiredValidation: [focused-negative-tests, postgres, typecheck, lint, build, independent-exact-head-review, authoritative-ci, dee-653]
approvalGates: [test-only-scope-preauthorized, integration-ready, dee-653-exact-head-admission]
provenance:
  createdFrom: controller-authorized-risk-expiry-test-remediation
  authoritativeBase: ce9a726100aee93ad993b60ee43feae0cb27cbc0
  recoverableBackup: backup/dee-796-pre-dee799-rebuild-e1be7262
state: admitted
---

# DEE-796 — deterministic PostgreSQL Risk expiry test boundary

## Frozen boundary

Change only the legacy PostgreSQL Risk V2 expiry test so its first consume is guaranteed to occur inside a bounded validity interval and its second consume is guaranteed to occur after expiry. Preserve the existing `CONSUMED`, `consumedNow` and `ALLOWANCE_EXPIRED` assertions.

## Invariants

- No production source, schema, Risk policy, scientific, security, holdout, live, execution or capital semantic change.
- No retry, skip, filter or assertion weakening.
- The test remains a real PostgreSQL timing/expiry proof.
- One branch, worktree, manifest and PR; squash only after all gates and DEE-653 PASS.

## Validation

Run the exact focused test repeatedly, the complete PostgreSQL Risk suite, the combined Decision/Risk/Execution PostgreSQL matrix, scoped lint, typecheck, build, exact-head independent review, authoritative CI and DEE-653.

## Acceptance

- The exact expiry test passes repeatedly and the combined Decision/Risk/Execution PostgreSQL matrix remains green.
- The bounded pre-consume validity and post-expiry wait preserve every existing consume and expiry assertion without retry, skip or production change.
- Canon, typecheck, scoped lint, build, literal fresh-migrated SQLite and independent exact-head review pass before publication; authoritative CI and DEE-653 pass before squash merge.
