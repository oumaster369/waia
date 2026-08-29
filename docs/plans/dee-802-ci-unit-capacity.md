---
integrationIssue: DEE-802
integrationTitle: "CI unit-suite bounded capacity"
parentIssue: DEE-755
branch: dee-802-ci-unit-capacity
riskTier: T3
prPolicy: one-integration-pr
authoritativeBase: 55ea7e2f3e3d6bc117d7b141dc1e8cba2edd8f0d
executionSurfaces: [github-actions, local, linear, github-pr]
requiredValidation: [focused, negative, full-fresh-sqlite, lint, typecheck, build, canon, independent-exact-head-review, authoritative-pr-ci]
approvalGates: [controller-authorized-ci-capacity, independent-exact-head-review, dee-653-exact-head-admission]
provenance:
  createdFrom: authoritative-ci-timeout-with-continuous-progress
  authorizedAt: "2026-08-29"
  authority: "Program Controller authorization for a separate admission-first CI-capacity train"
state: frozen
---

# DEE-802 — CI unit-suite bounded capacity

## Measured admission

- PR #517 completed the authoritative unit job in 43m35s under the 45-minute hard watchdog.
- PR #519 continuously completed new test files until the 45-minute watchdog fired: 743 unique test paths were observed, and the formerly slow Twin Engine facade test completed in 230ms.
- This is measured runner-capacity exhaustion, not a test hang or a production defect.

## Frozen scope

The implementation surfaces are `.github/workflows/ci.yml` and the diagnostic wrapper's invariant test. Pass `3600` rather than `2700` seconds to the existing wrapper, raise the outer GitHub job bound from 50 to 70 minutes so setup and TERM/KILL handling cannot preempt the inner watchdog, and assert both coherent values. The test command, selection, functional assertions, skips, retries, progress interval, complete log, TERM grace, process-group KILL, and exit preservation are unchanged.

## Gates

Focused wrapper timeout/KILL negatives, workflow invariant proof, typecheck, lint, production build, canon, one literal fresh-migrated SQLite suite, fresh exact-head independent review with zero P1/P2, authoritative CI, and DEE-653.

## Acceptance

The exact CI-only tree completes every mandatory local and authoritative gate while retaining coherent finite inner and outer watchdogs and all existing diagnostic and process-termination guarantees.

## Frozen local evidence

- Authoritative base: `55ea7e2f3e3d6bc117d7b141dc1e8cba2edd8f0d`.
- Recoverable pre-rebuild backup: `backup/dee-802-pre-rebuild-b3be8fc0`.
- Corrected admission commit: `e5f73680004a67e4e8a20a623a983444d48c3bf7`; admitted manifest digest: `ee75642e8625cd69bf9505c7dd09bcf0e69137f2b601814d62c4014a729bd68f`.
- Semantic commit: `4c2c3908aafe4c33df617ed041f6b8988963ccc8`; exact implementation surfaces are `.github/workflows/ci.yml` and `scripts/github/test-run-unit-tests-with-bounded-progress.sh`.
- Focused bounded-progress wrapper success/failure/timeout/TERM/KILL/exit negatives and coherent-bound invariants: 3 consecutive runs PASS.
- Literal fresh-migrated SQLite: `/private/tmp/dee802-rebuild-full.BFfKsJ/waia.sqlite`; 878 files and 5109 tests PASS, 0 failures; 83 files and 426 tests skipped by the repository profile; duration 1539.91 seconds.
- Typecheck PASS; lint 0 errors (296 baseline warnings); production build PASS; canonical validators PASS.
- Production diff is empty. The test command, selection, functional assertions, skips, retries, progress interval, complete log, TERM grace, process-group KILL, and exit preservation are byte-identical to base.
