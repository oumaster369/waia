---
integrationIssue: DEE-1091
integrationTitle: "Readable long console dialog titles"
branch: dee-1091-admin-dialog-long-title
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1091
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Deliver through DEE-1092 after exact-head CI and verify the long-title incident in production."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1091 — long-title dialogs

Authenticated production46f9 exposed a long Illegal invocation title with a URL. Dialog clientWidth574,scrollWidth697; the header text had intrinsic width625. Reaching Close scrolled the whole dialog123px horizontally, clipping the left of evidence and disrupting closing. This is actual UI evidence, not a hypothetical breakpoint concern.

## Acceptance and boundaries

Allow the header text to shrink and wrap long tokens; keep Close at its fixed visible size. Preserve the entire title, evidence, dismissible command guard and URL selection behavior. No hiding overflow, truncating data, runtime commands, schemas, finance, auth, or policy changes. Extend the real-Postgres incident workflow with this title and dialog-width/close-button checks at1280/720/360CSSpx. Demonstrate red before the style repair, green afterward, including existing forms/axe and all5PGbrowser workflows. Delivered as the second serialized source in pre-admitted DEE1092; original source T1, combined Worker batchT3 under explicit user operational delegation. No standalone PR needed.

## Validation

The original CSS fails the real browser width assertion. The fixed header passes all five PostgreSQL browser workflows in 2.6 minutes, including title/Close/URL behavior at 1280, 720 and 360 CSS pixels. Screenshots at 1280 and 360 were visually inspected. Cumulative data checks pass 36 tests; lint has zero errors and 324 pre-existing warnings, types, Next/OpenNext, both authority graphs, canon and governance pass. No independent review is claimed.
