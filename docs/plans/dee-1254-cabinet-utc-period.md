---
integrationIssue: DEE-1254
integrationTitle: "Filter cabinet financial history by UTC dates"
branch: dee-1254-cabinet-utc-period
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, focused-unit, mounted-chromium, build]
approvalGates: [plan-approved, independent-review, integration-ready]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-20T10:48:31.862Z"
  blockedReason: null
  nextAction: "Publish the validated branch for CI and review; no merge or deployment is included."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Goal and scope

Let users choose optional UTC start and inclusive through days for persisted financial history. Apply the same half-open bounds to every existing GET request and response check. Changing the applied period clears prior rows, cursor, coverage and loaded totals before the new response; the form stays mounted to preserve keyboard focus. Invalid native input or reversed dates retain the previous valid result and send no request.

This is one UI follow-up under DEE-1233. The parent remains open for broader product acceptance. Existing exact totals stay separated by currency and record type, cover only loaded records, and retain unknown completeness. No profit formula, currency conversion, schema, authorization or service contract changes are included.

## Completed work

- WP-1: UTC date controls and strict calendar parsing; filter-aware bounded paging; keyed result reset and late-response rejection; native validity and focus preservation.
- WP-2: focused date/boundary and rendered tests; mounted browser coverage for filtered pagination, clearing previous results, invalid input, focus, account isolation and revocation; desktop/mobile visual inspection; independent source review.

## Acceptance

- Optional start and through dates use UTC; the through date includes that whole day by sending the following midnight as the exclusive upper bound.
- Every page request and response check uses the applied period. Changing that period clears prior rows, cursor, coverage and loaded totals, and rejects late responses for the previous period.
- Invalid or reversed dates preserve the prior valid result and send no request. Applying a valid period preserves form focus.
- Loaded totals remain exact, separated by currency and record type, with unknown completeness. The change adds no profit claim, trading request or account-isolation exception.
- Focused tests, mounted browser coverage, build, typecheck, lint and independent review pass; PR CI must pass before integration.

## Validation and current stage

The six implementation/test files were validated before this publication commit: 37 focused tests across two files, production Next.js build, standalone TypeScript check, repository lint with zero errors and 337 existing warnings, and one mounted Chrome scenario using synthetic tenant/admin responses. Desktop/mobile screenshots were inspected. The independent review passed after the focus and native-validity fixes.

The implementation bytes remain unchanged when tracking moves from parent DEE-1233 to atomic child DEE-1254; no check rerun is claimed for this tracking-only publication step. `lastValidatedGitSha` is null because validation ran on the pre-commit working tree. The PR adds this plan alongside those reviewed files. Full unit validation belongs to PR CI. Local synthetic evidence does not establish production or provider acceptance.

## Review and rollout

Review this isolated UI change and its CI results. No migration, new configuration or deployment is part of this batch. P&L availability and complete account history remain separate work under the parent.
