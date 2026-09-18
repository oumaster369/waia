---
integrationIssue: DEE-774
integrationTitle: "Live Edge and Calibration Drift Restriction Authority"
parentIssue: DEE-601
branch: dee-774-live-edge-drift-restriction
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
  nextAction: "One PR to main after local gates. Do not wire Runtime/Risk/live, apply 0211, or touch C3/capital."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-774 — Live-edge drift restriction

## Goal

Create one versioned fail-closed restriction authority for deterioration of an exact promoted live
tuple. Drift can only preserve or reduce authority:

`NORMAL → NO_NEW_RISK → CLOSE_ONLY → SUPERVISED_STOP`.

This is not Runtime Authority, Risk sizing, Guardian, Execution or live promotion. Those surfaces
supply evidence or later consume the receipt. This batch grants no BUY/SELL, sizing or capital
authority.

## Canon check

- Runtime Authority V2 already owns startup/deadman postures (`FULL_ANALYSIS_AND_NEW_RISK` /
  `NO_NEW_RISK` / `CLOSE_ONLY` / `HALT`). DEE-774 uses a distinct restriction vocabulary including
  `SUPERVISED_STOP` and must not replace Runtime.
- DEE-640 / DEE-641 require this policy identity on the exact QualificationTuple. Recurring
  capital-effect composition remains DEE-639.
- Missing, stale, mismatched or unknown evidence fails closed. Silent recovery is forbidden.

## Work packages

### WP-1 — monotone restriction receipt

`assessLiveEdgeDriftRestrictionV2` binds the exact tuple/package/information-contract/runtime/live
envelope, scores the eight evidence channels, and emits a content-addressed restriction receipt.

### WP-2 — recovery + consumer inventory

Recovery to a wider posture requires cooling-off plus Human acknowledgement. Execution / live /
capital / holdout must not import the assessor as a permission source.

## Non-goals

- No production `0211`, H2/post-H2, C3, observation host, HTX, live-enable or capital.
- No Runtime/Risk/Execution wiring in this PR. Downstream consumption is DEE-639 / DEE-640.
