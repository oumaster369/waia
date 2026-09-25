---
integrationIssue: DEE-1077
integrationTitle: "Admin console entity evidence and detail workflows"
branch: dee-1077-admin-console-entity-evidence
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1077
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
  nextAction: "Implement and verify scoped entity detail reads and browser workflows."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1077 — entity evidence and detail workflows

## Goal and dependencies

Audit P9/P10/P11; DEE-1050 C3/C4/C5 and AC-04/06/07/08/09/10/11/12/13. Depends on merged DEE-1074/1076. Complete the six account and seven client detail tabs inside the existing eight-section console; orders expose their persisted evidence chain without trading actions.

## Read contract

- Order detail selects by id AND the same organization/account/mode filter as the list, with every joined evidence row constrained to its organization. Restore attempt, plan, Risk allowance/verdict, decision, forecast, reports, events and fills from explicit links. A legacy order has LEGACY_ORDER_NO_V2_BINDING, never manufactured stages. No raw request/observation payload or secrets are selected.
- Account financial detail extends the existing REPEATABLE READ READ ONLY projection. Show observed assets, independent connection/freshness/completeness/reconciliation/trade-permission facets and portfolio/activity/deployment/permission identities. Lack of Risk or deployment proof cannot grant entry permission. Exchange portfolios stay live under HALT or CLOSE_ONLY. Virtual paper portfolios stay separate and require persisted evidence.
- Account and client tabs reuse canonical scoped readers for orders, positions, strategies, invoices, payments and periods. Independent revisions are visibly distinguished; no recomputation of issued invoices. Saved events and revoked credential metadata remain readable, credential secrets never do.
- Every missing record has an explicit state/reason; foreign scope detail returns 404; context changes cancel pending reads and discard prior facts. Retain URL selection, Back and scroll, 1280px/200% usability, accessibility and decimal-string money.

## Acceptance

No changes to authorization policy, execution commands, Risk/Guardian decisions, commission, HWM, settlement, live eligibility, holdout or return methodology. No migration. Operational review/merge/deploy delegated by the user; exact-head tests still mandatory. Critical-engine fee investigation remains separate DEE-1078.

Validation: pnpm lint; pnpm typecheck; pnpm build; targeted admin-console unit and local Postgres integration tests proving scope, missing/legacy evidence and safe metadata; pnpm test:e2e:admin-pg for all detail tabs, orders chain and client history; pnpm validate:canon; execution consumer graph and PR governance preflight. Full unit and Postgres gates on exact PR head before merge.
