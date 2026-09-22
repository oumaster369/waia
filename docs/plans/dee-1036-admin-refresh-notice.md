---
integrationIssue: DEE-1036
integrationTitle: "Admin HTX list says when a later refresh failed"
parentIssue: DEE-961
branch: dee-1036-admin-refresh-notice
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

# DEE-1036 — Admin HTX list refresh notice

### WP-1

When a later admin account-list refresh fails, keep the previous rows and say the latest refresh failed. The first failed load still replaces the page with the error state. A later success clears the notice.

## Acceptance

- Later refresh failure keeps the previous accounts and shows the refresh notice.
- First-load failure still uses the error state.
- No PnL, live orders, Connect, observation host, or C3 change.
