---
integrationIssue: DEE-1204
integrationTitle: "AI-TRADER: fail closed and report portfolio freshness in scheduled paper cycles"
branch: dee-1204-paper-account-freshness
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, build, focused-paper-loop-unit, validate-canon, graph-validation, exact-head-ci]
approvalGates: [plan-approved, independent-review, exact-head-ci, human-merge]
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Complete independent review and exact-head CI; local focused tests, lint, typecheck, build, canon and graph checks are green on the current uncommitted source."
provenance:
  createdFrom: user-authorized-ai-trader-audit-2026-10-01
  gapRegistry: null
  supersedes: null
---

# DEE-1204 — scheduled paper account freshness

## Problem and boundary

`runPaperLoopCycle` currently replaces a failed initial portfolio/account read with `EMPTY_STATE`, then invokes paper evaluation with an account that was not actually observed. After the cycle, a failed refresh silently retains the earlier state while reporting `stateRefreshed: true`; the completion telemetry also uses a mode default that can mislabel a paper run as mock. The enabled path already performs startup reconciliation before the initial account read. This change does not undo or relabel that earlier work.

On initial portfolio or open-order read failure, the scheduled cycle must return an explicit blocked/unavailable report and must not invoke `runPaperCycleOnce`, decision/risk/execution, or successful cycle-complete telemetry. On post-cycle refresh failure, preserve the completed cycle's true submitted/blocked outcome, report stale account state and `stateRefreshed: false` in the report, logger and telemetry, and attach only a bounded error class/status. Supply the resolved execution mode (`paper` or `mock`) to telemetry. Disabled no-op behavior and successful-cycle behavior remain unchanged.

Current V2 decision and legacy-submit fences remain in force. This package does not add execution authority, retry behavior, leases, connector persistence, financial policy, live operation, or production readiness.

## Work packages

### WP-1 — failure-path regressions

Add focused tests through the actual exported `runPaperLoopCycle` for initial portfolio-read failure, initial open-order failure, disabled mode, success, and post-cycle refresh failure. Assert initial failures do not invoke the cycle or completion emitter, while startup reconciliation is reported as already performed. Assert a post-cycle refresh failure preserves a submitted fixture outcome and reports stale refresh state with the correct paper/mock mode. Keep dependency injection limited to the existing repository/service seams.

### WP-2 — bounded implementation

Add the additive report fields needed to distinguish unavailable initial state and stale post-cycle state. Remove the empty-account fallback at the initial read boundary. Make telemetry/logger report actual refresh state and resolved execution mode.

### WP-3 — local readiness and review

Run affected paper-loop tests, lint, typecheck, build, canonical validation and graph validation, then complete independent review and exact-head CI. Do not mark this work package complete until review and CI are green.

## Acceptance

- Initial portfolio derivation failure and initial open-order read failure return explicit blocked/unavailable reports; `runPaperCycleOnce`, decision/risk/execution, and successful completion telemetry are not called.
- Startup reconciliation ordering remains unchanged and its earlier completion is not claimed rolled back.
- Disabled mode remains a dependency-free no-op; successful cycle behavior remains unchanged.
- A post-cycle refresh failure preserves the original submitted/blocked result and reports `stateRefreshed: false`, stale account status and a bounded error class in report/logger/telemetry.
- Telemetry reflects the actual resolved `paper` or `mock` mode.
- Focused worker regressions, lint, typecheck, build, `validate:canon`, graph validation, independent review and exact-head CI pass.

## Do not

Do not change execution authority, retry or resend behavior, Risk policy, strategy or sizing, startup reconciliation semantics, worker lease/fencing, mock connector persistence, migrations, venue calls, production data, live activation, or paper capital cutover.
