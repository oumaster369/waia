---
integrationIssue: DEE-951
integrationTitle: "Apply current modeled Guardian before Risk and cancel protected pending entries"
branch: dee-951-current-guardian
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Root review and remaining integration readiness gates before commit/PR"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Authority and scope

Human approved implementation and PR preparation for DEE-946–951 on 2026-09-06.
This isolated T3 package fixes DEE-951 only. No merge, deployment, production writes,
private exchange credentials, live orders, capital, holdout, or safety/scientific threshold changes.
The root controller owns integration review and Linear updates.

## Acceptance

The post-fill Accounting Frontier was current while Risk still used the previous
Guardian posture. A canonical loss-making full close could therefore admit a new
BUY before the same cycle's ledger reported STOP_ACCOUNT.

1. WP-1: resolve current drawdown protection before Risk, retaining the strongest
   restored restriction and existing accounting posture; use the same rules for ledger.
2. WP-1: queue cancellation of pending BUY quantities under already-known protection
   before advancing the exchange, preserve SELL exits and existing modeled cancellation latency.
   Newly discovered post-advance breaches prevent new entries and queue remaining BUY cancellation.
3. WP-2: canonical accounting-derived loss regression, threshold equality, restored
   STOP/CLOSE protection, pending partial BUY cancellation/restart, and strict reduction tests.
4. Run focused unit tests and typecheck; root integration owns remaining lint/build/CI gates.

## Causality and non-goals

Do not use the current bar's later accounting result to retroactively cancel an earlier
eligible fill. Pre-advance cancellation uses only the prior frontier and restored Guardian;
post-advance protection uses the updated frontier before current Decision/Risk.
No new migration or persistence schema; cancellation uses the existing checkpoint and
exchange persistence transition. All corpus, qualification, Forecast and learning semantics stay unchanged.
Existing Risk V2 strict-reduction admission remains allowed under CLOSE_ONLY, refused under
HALT/STOP_ACCOUNT and KILLED. This package does not broaden liquidation authority; pending
already-authorized SELL orders are not cancelled by its entry cancellation rule.

## Local implementation evidence

On base `4a98f3ac`, the current-frontier resolver is used before modeled admission and
ledger projection. Production prepares prior-checkpoint BUY cancellation before exchange
advance and queues current-breach remaining entry cancellation after advance. SELL orders
are untouched; the original cancellation latency and checkpoint format are retained.

Local typecheck passed. Six focused files passed, 47 tests including nine new Guardian
regressions. Scoped ESLint passed with two pre-existing unused-variable warnings in old files;
the new helper and test have no lint warnings. `git diff --check` passed.
The formerly misleading ledger expectation of NONE with an explicit CLOSE_ONLY accounting
posture now expects CLOSE_ONLY, matching the admission restriction. No assertion was removed.
Root review, build/full readiness gates, commit and PR remain pending; no production action occurred.
