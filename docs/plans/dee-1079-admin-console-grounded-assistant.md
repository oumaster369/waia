---
integrationIssue: DEE-1079
integrationTitle: "Admin console grounded read-only assistant"
branch: dee-1079-admin-console-grounded-assistant
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1079
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Implement and verify grounded facts, contextual conversations and browser workflows."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1079 — grounded read-only assistant

## Goal and dependencies

Audit P17 / D-08, D-25 and DEE-1050 AC-26/27/28. Depends on DEE-1077 shared entity readers. Connect Russian quick answers and assistant conversation UI to the canonical scoped data functions.

## Acceptance

- Model output can select only server-issued fact references. Labels, values, currency, entity, scope, revision and source links are server-rendered together. Matching a count does not authorize a capital claim. Uncited or model-authored facts are removed with an explicit note.
- Same-reader quick answers work while the model flag is off. Full financial aggregates use the saved reader aggregate, never a truncated list sum. Partial coverage is visible as N/M, unknown totals remain unknown.
- Every request/history entry retains scope, period, mode, currency and evidence revisions. Changing context aborts requests and removes prior facts; conversation history is owner-scoped and filtered by the selected context. Foreign conversation/message returns 404.
- Provider failure affects only the assistant. Read-only tools use explicit safe projections, no secrets/AI-TWIN/holdout payload. No arbitrary model tool execution, new financial or trading commands, code index or streamed model text.
- Validate targeted grounding/counterexample/provider/context unit tests, real Postgres parity and ownership, browser quick answers/context/history, lint/typecheck/build/canon and PR governance. Full exact-head CI before delegated squash merge and verified-main rollout.
