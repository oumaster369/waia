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
state: frozen
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

## Frozen validated local evidence

- Exact authoritative base: `4f46b953cdae58c849895fb4f51ae7b8edf1514d`.
- Recoverable backup: `backup/dee-799-pre-dee802-rebase-8ad2bc36`.
- Admission-first commit: `241a2a65d424d1c93d6397550e1f6d90d68cc0d2`.
- Admitted manifest digest: `22915ca77eb41dc7bafccdf624c1ade4f6e988794ff0eb0d0e14d4220300b387`.
- Semantic commit: `176f0b2b731ddc9d121972db37985d736458dc60`.
- Focused positive/negative facade proof: three consecutive runs, `4/4` each (`12/12` total), bounded at approximately `94-105 ms` per run.
- Literal full fresh-migrated SQLite: `878` files passed and `83` skipped (`961` total); `5109` tests passed and `426` skipped (`5535` total); `0` failures; database `/private/tmp/dee799-current-main-full.fX8pe3/waia.sqlite`; duration `1261.13 s`.
- Typecheck PASS; lint PASS with zero errors (296 repository-baseline warnings); production build PASS; canonical validation PASS.
- Production diff is empty. The sole semantic file remains `tests/unit/twin-engine-runtime-facade.test.ts`, replacing recursive proxy traversal with strict delegated-handle identity while preserving all other assertions.
