---
integrationIssue: DEE-1093
integrationTitle: "Atomic concurrent diagnostic incidents"
branch: dee-1093-admin-incident-atomic
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1093
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Reproduce concurrent diagnostic/audit failures on local Postgres, apply the minimal transaction/locking correction, then integrate merged658 before publication."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1093 — preserve concurrent incident evidence

Supabase production logs at 2026-09-25 06:16:19.382 and 19.490 UTC contain SQLSTATE23505 on trader_admin_incident_environment_service_fingerprint_unique. Current insertDiagnostic persists raw evidence, selects an incident, then writes state and history independently. The first insert races, repeats can lose count/revision, and an update can overwrite an operator's newer status.

## Acceptance

Demonstrate real-Postgres failures before repair: concurrent first observations, repeats, resolved recurrence and rollback of failed history; coordinate an actual guarded operator command with a collector and prove no lost actor history or state. Put diagnostic, incident and required history in one transaction; serialize identical environment/service/fingerprint and lock the current row before reading its status. Keep existing optimistic commands, redaction, fingerprint and transitions. Run incident workflow/final acceptance, collector regressions, lint/types/Next/OpenNext, graphs, canon/governance and all exact-head CI.

## Boundaries and delivery

Files: this plan, lib/trader/admin-console/collectors/postgres-store.ts, tests/integration/admin-console-incident-atomic-postgres.test.ts. No financial, auth, policy, schema, trading or historical-data changes. User explicitly delegates operational self-review/merge/publication; no independent review or automatic bounded authority is claimed. Implement while658 runs, then merge fresh main after658 into this unpublished branch before final readiness and one PR. Production failure injection is forbidden; acceptance uses real scheduled receipts, diagnostics/audit integrity and read-only evidence.

## Validation evidence

Six real-Postgres tests fail against original code, including an actual guarded operator command being overwritten. A seventh test separately reproduces reversed resolution/recurrence history timestamps after waiting on the row lock. All seven pass after atomic persistence, locked re-read and recording history at the transition write time; diagnostic occurrence time remains unchanged. The combined six-file suite passes41tests. Changed-file lint and types pass; final merged-main readiness remains required. DEE-1094 separately owns the one proven pre-existing production count mismatch (three diagnostic rows versus one occurrence); this code change does not rewrite historical records.
