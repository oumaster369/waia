---
integrationIssue: DEE-1083
integrationTitle: "Complete canonical admin exports, saved views and billing evidence"
branch: dee-1083-admin-console-views-exports
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1083
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
  nextAction: "Complete real-Postgres/browser acceptance, replay on merged PR650 main and require all exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1083 — final read-workflow completeness

The user explicitly authorized autonomous completion, self-acceptance, PR/merge/database/production operations. A direct final comparison with C3/C7 found missing saved-view UI and six CSV datasets. A new negative test also disproved provisional AC-18 acceptance: the invoice read joined exceptions only through an already applied settlement. This packet corrects those read surfaces; it does not claim that the prior acceptance proved them.

## Acceptance

- Shared canonical list readers feed HTTP, assistant and seven CSV datasets. Every export uses one repeatable-read read-only transaction, decimal strings, explicit row/time limits, driver cancellation (including one-connection pools), formula-safe cells and scope/revision metadata. Bounded DTO rows are validated before headers, then CSV is encoded in backpressure-driven chunks; no database-cursor streaming claim. The shared HTTP result adapter adds an optional stream response without changing authorization. Saved invoice JSON/CSV uses the same persisted detail; foreign scope remains 404.
- Personal views use the existing owner-scoped API and revision CAS. URL restoration accepts only the eight sections and whitelisted filter fields. Built-in presets have actual matching filters. Scope changes abort pending export and discard stale UI results.
- Invoice detail shows persisted payment stages, settlement/application distinctions, corrections, disputes and audit. A settlement exception before application is visible without making the invoice PAID or changing any saved amount. Existing dispute tab includes correction/reconciliation records. Direct invoice selection is independent of the first list page.
- Readable Russian labels; keyboard and responsive checks cover the added controls.

Do not change billing computation, fee rate, HWM, settlement, authorization grants, execution/Guardian/Risk, live eligibility, holdout or schema. Financial source records remain immutable. The minimal invoice projection change has a reproduced red/green Postgres test and is covered by the user's delegated operational gate. No independent reviewer is claimed.

## WP-1 — canonical reads and operator workflows

Implement the scoped exports, owner-only view restoration and read-only billing evidence listed above as one separately validated delivery.

## Validation and rollout

Focused and combined console/assistant unit and real-Postgres suites, cancellation/deadline/readonly proof, browser save-switch-restore-download-delete flow, all existing five admin Postgres browser checks, pnpm lint/typecheck/build, canon and both authority graphs. Exact-head full GitHub CI is mandatory. Prepare against frozen PR650, replay only this delta onto its verified squash main before PR publication. Merge after checks, deploy verified main, preserve previous Worker for rollback, then read-only production acceptance. No real trading or billing command during production QA.

Local acceptance: 344 combined tests passed; two existing opt-ins are separately proven on the dedicated validation profile. Five real-Postgres browser scenarios pass, and both workflow scenarios pass again after streaming/layout changes. The original AC18 failure and test-harness corrections are retained in evidence; no threshold changes. Exact-head CI and production acceptance still pending.
