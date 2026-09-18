---
integrationIssue: DEE-773
integrationTitle: "Qualify Future-Cycle Epistemic Effect of Outcome and Calibration Evidence"
parentIssue: DEE-601
branch: dee-773-future-cycle-epistemic-effect
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Local gates then one PR to main. Do not apply 0211, C3, live, capital, or observation host in this batch."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-773 — Future-cycle epistemic effect

## Goal

Unseal the reserved `QUALIFIED_VERDICT_UPDATE` delta under a bounded scientific policy, then prove
that sealed Forecast V2 outcome/calibration evidence can change a **later** cycle's Navigator
selection. PnL-only, unsealed, same-cycle and lookahead evidence have zero authority.

## Canon check

- DEE-771 reserved non-zero `QUALIFIED_VERDICT_UPDATE` as `QUALIFIED_VERDICT_DELTA_RESERVED_DEE_773`.
- DEE-772 Navigator is on `main` (`7ea1f2d6`). This batch consumes it; it does not mutate Forecast
  runtime admission. Recurring builder composition remains DEE-639.
- DEE-633 already emits Knowledge confidence updates. This batch does not become a second Knowledge
  writer and grants no Decision/Risk/Execution/capital authority.

## Work packages

### WP-1 — bounded qualified verdict Δ

`assessQualifiedVerdictUpdateV2` allows confidence change ≤ `EPISTEMIC_CONFIDENCE_UPDATE_CAP` and
verified/relationKind/lifecycle change. Edge identity (`fromRef`/`toRef`/hypothesis/regime/failure
cases/strength) cannot move. Unbounded confidence and identity mutation refuse.

### WP-2 — future-cycle Navigator effect receipt

`qualifyFutureCycleEpistemicEffectV2` binds prior/future Navigator receipts. Sealed
outcome+calibration may change later selection. Unsealed / PnL-only / same-cycle / lookahead replay
the prior receipt as `ZERO_EFFECT`.

## Non-goals

- No production `0211` apply, no H2/post-H2, no C3, no observation host, no HTX, no live/capital.
- No Forecast runtime wiring (DEE-639 recurring builder).
