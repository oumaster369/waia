---
integrationIssue: DEE-937
integrationTitle: "Managed PostgreSQL runner role compatibility"
branch: dee-937-managed-postgres-role-hardening
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-ci]
requiredValidation: [lint, typecheck, unit, build, postgres-integration]
approvalGates: [plan-approved, integration-ready, human-merge, human-production]
includedIssues: []
dependsOn: [DEE-920]
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Open the single PR and await exact-head CI and Human merge approval"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Approved scope

Human authorized DEE-937 on 2026-09-05: minimum fix of migration 0199 and runner
LOGIN provisioning, plus PostgreSQL 17 limited-administrator verification.
No merge, production deployment, credentials mutation, capital, live trading,
blind holdout or Human-gate bypass is authorized by this task.

PR #551 / squash `13149b82b256897811afd77dcd4f35139c16d7df` is the prerequisite
implementation. This fix blocks the remaining DEE-920 rollout, not its merged code.

## Root cause and bounded correction

PostgreSQL rejects explicit `NOSUPERUSER` in `ALTER ROLE` by a non-superuser,
even for an already non-superuser target. Existing CI migrated as superuser.
Precheck all five dangerous attributes and reject any privileged target; alter
only LOGIN/INHERIT/connection limit/password as applicable; preserve complete
postconditions, membership checks, RLS and grants. Do not catch/ignore 42501.
Independent review also found that repeated GRANT retains omitted membership
options. Existing LOGIN membership must already be ADMIN false / INHERIT false /
SET true; reject mismatches, grant explicitly and verify all three afterward.

0199 was proven **not applied** in production: the 0193–0202 attempt rolled back
atomically; journal tail remains 0192. This explicitly approved correction edits
the pending migration, not a successfully applied production migration. Databases
that already applied the old hash need a separately verified history assessment;
never rewrite their journal automatically. No new schema object is needed.

## Acceptance

- WP-1: minimum migration/provisioner correction; no algorithm or formula changes.
- WP-2: original 42501 reproduction; full 0199 under non-superuser with ADMIN OPTION;
  new LOGIN and rotation; dangerous attributes/missing authority fail closed;
  existing runner RLS boundary tests; lint/typecheck/build and independent review.

## Validation and recovery

All mutation tests run on disposable localhost PostgreSQL, never production.
Regression is included by the existing PostgreSQL integration test entrypoint;
no CI gate is removed or timeout changed. PostgreSQL 17 is verified locally.
Failure leaves the transaction rolled back. Rollout remains a separately approved
exact-SHA operation after review and merge. Never retry the old production batch.

## Local evidence — 2026-09-05

- Disposable `postgres:17-alpine`: PostgreSQL **17.11**, loopback-only port 55437.
- Auth prelude + full fresh migration chain through 0202: PASS.
- `tests/integration/postgres-historical-runner-least-privilege-v2.test.ts`:
  **41/41 PASS** with both role provisioning switches enabled, including actual
  non-superuser administrator session, full 0199 under limited ownership,
  original 42501 reproduction, all five dangerous flags, missing ADMIN OPTION on
  both roles, parent membership, all three LOGIN membership-option failures,
  real SCRAM authentication/rotation and old-password rejection.
- Two targeted unit files: **11/11 PASS**. Combined **52/52**, zero skips.
- Full lint: zero errors (existing repository warnings); changed-file lint clean.
- Typecheck and production-mode Next build: PASS. No UI changes; no local E2E rerun.
- Independent working-diff review: P1=0/P2=0; exact committed head binding follows
  in Linear/PR evidence. Full unit/build/PostgreSQL CI remains mandatory on PR head.
- This is role/migration compatibility evidence, **not** production Historical
  Simulation acceptance, adaptive learning validation, or live-capital authority.
