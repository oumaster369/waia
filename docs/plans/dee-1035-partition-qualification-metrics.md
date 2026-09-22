---
integrationIssue: DEE-1035
integrationTitle: "Derive DEVELOPMENT and walk-forward qualification from partition window metrics"
parentIssue: DEE-646
branch: dee-1035-partition-qualification-metrics
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
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "PR to main. Do not mark DEE-646 Done."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1035 — Partition window qualification metrics

Enabled discovery derives DEVELOPMENT and walk-forward evaluations from recorded
partition windows. It does not invent those numbers from closed-trade outcomes
and does not accept a supplied evaluation that disagrees with the windows.

Default discovery stays off. Blind holdout remains forbidden as fitness.
No C3, Execution Server, production `0211`, or live orders.

### WP-1 — Derive evaluations from recorded windows

`deriveQualificationEvaluationFromPartitionWindowsV2` sums net result, keeps the
worst drawdown, and sums tail events and closed-trade sample. Enabled discovery
requires the windows and refuses a supplied evaluation that does not match.

## Acceptance

- One window reproduces its recorded metrics. Two windows sum.
- Holdout, a zero sample, and a duplicate window id fail closed.
- Enabled discovery without windows fails closed `research_v2_admission_incomplete`.
- A mismatched supplied evaluation fails closed `QUALIFICATION_PARTITION_METRICS_MISMATCH`.
- Default discovery still skips with `discovery_run_disabled`.
- DEE-646 stays In Progress.
