---
integrationIssue: DEE-1037
integrationTitle: "Trader profile settings for display name and locale"
parentIssue: DEE-776
branch: dee-1037-trader-profile-settings
riskTier: T2
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
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "PR to main after required CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1037 — Trader profile settings

### WP-1

Show display name and locale on the live Trader cabinet and save them through the existing profile API. A rejected save restores the last loaded values. The panel states that it does not change capital authority.

## Acceptance

- The cabinet loads and saves display name and locale.
- A server validation error is shown and the previous values remain.
- Sessions, notifications, HTX credentials, export, and delete are not added.
- Parent DEE-776 stays open.
