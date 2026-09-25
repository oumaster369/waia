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

Do not change billing computation, fee rate, HWM, settlement, authorization grants, execution/Guardian/Risk, live eligibility, holdout or evidence schema. Financial source records remain immutable. The minimal invoice projection change has a reproduced red/green Postgres test and is covered by the user's delegated operational gate. No independent reviewer is claimed.

## WP-1 — canonical reads and operator workflows

Implement the scoped exports, owner-only view restoration and read-only billing evidence listed above as one separately validated delivery.

## Validation and rollout

Focused and combined console/assistant unit and real-Postgres suites, cancellation/deadline/readonly proof, browser save-switch-restore-download-delete flow, all existing five admin Postgres browser checks, pnpm lint/typecheck/build, canon and both authority graphs. Exact-head full GitHub CI is mandatory. Prepare against frozen PR650, replay only this delta onto its verified squash main before PR publication. Merge after checks, deploy verified main, preserve previous Worker for rollback, then read-only production acceptance. No real trading or billing command during production QA.

Local acceptance: 344 combined tests passed; two existing opt-ins are separately proven on the dedicated validation profile. Five real-Postgres browser scenarios pass, and both workflow scenarios pass again after streaming/layout changes. The original AC18 failure and test-harness corrections are retained in evidence; no threshold changes. Exact-head CI and production acceptance still pending.

## Production read-latency correction

Pre-rollout browser acceptance found the Accounts page repeatedly loading while observation reads overlapped for 23-53 seconds. The existing hook started six requests over five polling intervals instead of letting the original same-scope read complete. Add in-flight exclusion and a 30-second explicit timeout retaining the last good same-scope value. Scope changes still abort immediately and reject late responses.

Migration 0217 adds only two partial lookup indexes on immutable observations, using the exact existing balance-complete and first-success predicates; no ledger rewrite, grants, RLS or financial semantics change. The local 8,000-observation EXPLAIN regression proves the first-success lookup stops scanning all partial records. Local migration and 19 focused snapshot/entity/hook/index tests pass. The independently validated additive indexes may be staged before the code merge under the user-delegated operational repair gate: create concurrently to avoid blocking observation writes, verify both definitions/validity, then record the exact canonical Drizzle migration hash. Full exact-head CI remains mandatory for the code merge/deployment; verify index validity and the actual browser read latency. Rollback is code rollback with additive indexes retained, not destructive ledger changes.

Invoice context acceptance: a Postgres red test proved detail returned mode=all for a live request. The envelope now preserves query.mode; the real browser opens a seeded invoice in Live, verifies stored fee, all six unchecked attestations, disabled approval and the downloaded persisted JSON. Both expanded workflows pass.

Operational staging rationale: an actual production first-success read hit server cancellation after 121 seconds, and its EXPLAIN used the identity index followed by JSON payload filtering/sorting. This is a reproduced availability defect. Local migration and regression checks pass. Concurrent index creation is an equivalent operational application of the canonical index definitions; it changes neither data nor financial authority. If the Supabase migration connector cannot connect, use the existing configured Postgres connection without printing credentials, record that fallback and verify the exact schema outcome before writing the canonical migration receipt.
