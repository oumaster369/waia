---
integrationIssue: DEE-1008
integrationTitle: "Historical qualification: make merged missing-only Forecast producer operationally executable"
branch: dee-1008-executable-producer
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-EXECUTABLE
  completedWorkPackages: []
  remainingWorkPackages: [WP-EXECUTABLE, WP-REVIEW]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Open one PR to main. After Human squash-merge, freeze NEW P as the squash SHA. Do not execute H-P, transfer G1, or mutate the Execution Server from this issue."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  parentIssue: DEE-950
---

# DEE-1008 — operational producer entrypoint

## Scope

Exact merged P `ffb2fd608a3d5496964d6c7d60e5e6f2463c58cc` already contains
`issueControlForecastBatchV1` and `issueMissingForecastBatchV1`. The dedicated CLI
only supported `--mode enumerate` and refused `control` / `issue`. No other merged
canonical executable invoked those functions.

This issue exposes that already-reviewed library through the same CLI:

- `enumerate` is unchanged.
- `control` is the C1 process path: sealed G1, explicit P SHA, runtime identity,
  no-build selected-package load, mapped WF anchors, `issueControlForecastBatchV1`,
  no O/P production writes, bounded JSON.
- `issue` is the C2/C3 worker primitive: same mapping/package/anchors, origin
  read-only, separate producer evidence and journal roots,
  `issueMissingForecastBatchV1`, durable seal, refuse completed, retry incomplete
  claims only.

Package loading uses `readPreservedScientificPackageNoBuildV1` (existing-store
hydrate only). Production path never constructs a selected package and never
exposes builder/fallback flags.

## Do not

- Invent a second Forecast algorithm or duplicate `issueForecastV1`.
- Build the C2 multi-worker supervisor.
- Execute H-P, transfer G1, or mutate the Execution Server.
- Merge PR #590 on old P, or merge #585–#588.

## Acceptance

Canonical CLI process can run enumerate, control, and issue. Subprocess tests
prove control 32-row deterministic replay, issue seal/skip/duplicate-refuse,
builder flags refuse, and wrong G1/package/P/runtime/origin refuse. Producer
source still contains no bootstrap/admission/live/exchange capability.

After Human squash-merge, NEW P is the squash SHA; old P is superseded for launch
execution.
