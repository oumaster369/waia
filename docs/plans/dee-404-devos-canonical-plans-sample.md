---
integrationIssue: DEE-404
integrationTitle: "DEV OS: canonical plans and state primitive (vNext Slice C)"
branch: dee-404-devos-canonical-plans
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: approved
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Implement docs/plans/ infrastructure and command updates"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# Sample canonical plan (Slice C)

This file demonstrates the committed canonical plan format. It is the operational plan for Slice C itself.

## WP-1 — Establish docs/plans/

- Create `docs/plans/README.md`, archive directory, this sample.
- Update commands and PR template `**Plan:**` field.
- Confirm `.cursor/plans/` gitignored; `docs/plans/` tracked.

## Acceptance

- Fresh clone resolves this plan by `integrationIssue: DEE-404`.
- `/implement` can find plan matching branch `dee-404-devos-canonical-plans`.
