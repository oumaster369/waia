---
integrationIssue: DEE-799
integrationTitle: "Deterministic Twin Engine facade proxy assertion harness"
parentIssue: DEE-755
branch: dee-799-twin-facade-proxy-harness
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: 4f46b953cdae58c849895fb4f51ae7b8edf1514d
executionSurfaces: [local, github-actions, linear, github-pr]
requiredValidation: [focused, negative, full-fresh-sqlite, lint, typecheck, build, canon, independent-exact-head-review, authoritative-pr-ci]
approvalGates: [controller-authorized-test-harness-remediation, independent-exact-head-review, dee-653-exact-head-admission]
provenance:
  createdFrom: authoritative-ci-failure
  authorizedAt: "2026-08-29"
  authority: "Program Controller authorization for a separate admission-first test-only train"
state: admitted
---

# DEE-799 — deterministic Twin Engine facade proxy assertion harness

## Frozen boundary

Change only `tests/unit/twin-engine-runtime-facade.test.ts`. Replace the recursive structural matcher over the Drizzle mock proxy with a strict identity assertion for the delegated database handle. Preserve result identity, exact input, call count, scenario-limit rejection, and the production persistence/runtime code byte-for-byte.

## Proven defect

PR #518 run 33227987035 reports the facade test PASS after 771012 ms and then reaches the 2700-second unit watchdog. Exact-head isolated reproduction is CPU-bound. A process stack sample shows recursive proxy property getters under the structural matcher. This is a test-harness defect, not a production failure.

## Invariants

- No product, runtime, schema, scientific, security, holdout, live, execution or capital change.
- No skipped, filtered, retried or weakened assertion.
- The same database object must be delegated by reference.
- One dedicated branch, worktree, manifest and PR.

## Acceptance

Focused test completes repeatedly in bounded time; production diff is empty; literal full fresh-migrated SQLite, typecheck, lint, build and canonical validation pass; independent exact-head review is P1=0/P2=0; authoritative CI and DEE-653 pass before squash merge.
