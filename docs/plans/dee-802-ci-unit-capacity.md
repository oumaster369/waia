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
state: admitted
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
