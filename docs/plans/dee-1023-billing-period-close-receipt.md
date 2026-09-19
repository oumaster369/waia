---
integrationIssue: DEE-1023
integrationTitle: "Cut over billing period-close to RealizedStrategyProfitReceiptV2"
parentIssue: DEE-601
branch: dee-1023-billing-period-close-receipt
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
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-5]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "PR to main after independent in-diff P1=0 P2=0 and required CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1023 — Billing period-close orchestrator cutover

Split from [DEE-638](https://linear.app/deepsense/issue/DEE-638) after `#610`. One
integration issue = one PR; this batch owns only the WP-5 orchestrator cutover.

## Goal

`closeAndMaterialize` consumes a rebuilt `RealizedStrategyProfitReceiptV2` and
refuses a caller-supplied `realizedPnl` before any Billing HWM or period write.

## Canon check

- Step 19: unknown financial truth is not revenue.
- Naked `CloseAndMaterializeInput.realizedPnl` is removed as authority.
- Receipt `reportingScopeId` is
  `billing-period/v2:{org}:{account}:{periodStart}/{periodEnd}`.
- An already-open period must share that `periodStart`.
- A second close of the same `periodStart` is refused.
- Truncated closed-period listing fails closed.
- `materializeDraft` does not mint receipt-grade evidence for a legacy naked close.
- No production `0211`. Reality-store lookup, receipt tables, DB unique index, and
  lifecycle naked-close quarantine remain on DEE-638.

## Non-goals

- No C3, holdout, live/capital, Execution Server, observation host.
- No DRAFT → ISSUED automation.
- Do not modify `lib/trader/execution/**`, `live/**`, `risk/**`, `knowledge/**`.
