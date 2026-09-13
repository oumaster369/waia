---
integrationIssue: DEE-958
integrationTitle: "Durable historical preparation attempt diagnostics"
branch: dee-958-preparation-attempt-events
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, targeted-unit, postgres-integration]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
state:
  status: in-progress
  currentWorkPackage: WP-VERIFY
  completedWorkPackages: [WP-REPRODUCE, WP-EVENTS, WP-WIRING]
  remainingWorkPackages: [WP-VERIFY]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: ded0cb0d2e37cb45d9c8c17007d9a69860fd2a11
  blockedReason: null
  nextAction: "Frozen backend review and cumulative integration gates; no deployment."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Scope and authority

Root authorized this atomic backend implementation under DEE-958 on 2026-09-07.
Base is the unpublished cumulative ded0cb0d; dependencies are not admitted to PR560.
0204 follows local0203, while current origin/main b5 contains only through0202.
Publication requires coordinated dependency review and current ordinal verification.

## Acceptance

- Start only after request validation and compute advisory lock acquisition.
- Record diagnostics through a separate short transaction; computation rollback
  cannot erase its prior STARTED or failure. Use at most two database connections.
- Bind request/org/run/release/digest and attempt; preserve immutable Human rows.
- Append-only events, no public grants, same-org runner INSERT/SELECT only.
- Old attempt cannot overwrite a newer attempt. An interrupted attempt with no
  terminal confirmation remains unknown, never inferred successful or failed.
- Only a real sealed proposal proves availability; diagnostic events grant no authority.
- Whitelisted public error enum only; full existing redacted CLI errors remain private.
- No automatic retry, scientific changes, new capital, holdout, production or secret access.

## Validation

Before implementation9mock-boundary tests passed: actual preparation failure and
cleanup leave the same REQUEST_RECORDED projection as never-started work. This is
defect reproduction, not operational acceptance. Add state/writer tests and actual
PostgreSQL17 role, cross-org, mutation, sequence and compute-rollback tests.

### Local implementation evidence — 2026-09-07

- Dedicated journal pool has short connection/query/lock bounds (10s/10s/3s),
  plus a 15s I/O deadline including reservation and cleanup. These are not
  scientific computation limits. Unknown INSERT acknowledgement is never retried.
- DB-owned identity ordering and timestamp cannot be supplied by runner. INSERT
  privileges are column-scoped, excluding both id and observed_at. FORCE RLS and
  explicit PUBLIC/anon/authenticated revocation apply to the new table only.
- Owner SELECT policy supports the existing trusted backend service architecture,
  not a tenant identity: the existing authenticated HTTP scope validation remains
  mandatory. Owner INSERT is not granted by this policy.
- Only the latest STARTED attempt is projected. PROGRESS is bounded/coalesced
  observed-counter telemetry, not a complete scientific audit or estimated percent.
- FAILED is attempted independently even after a progress-write rejection;
  primary and journal errors are preserved as AggregateError when needed.
  Terminal proposal confirmation occurs before releasing the computation lock.
- Typecheck and 32 targeted mock-boundary tests passed. The initial stalled-write
  test used a matcher unavailable in Vitest2; corrected to equivalent count and
  argument assertions, then rerun passed. No implementation assertion was removed.
- Seven actual PG17 tests passed in `waia_test_dee958_6fea93d1`: restricted-owner
  migration, actual runner scope/mutation/identity denial, bounded lock wait,
  compute rollback, and real constrained LOGIN with two pools. Third connection
  refused with53300; after terminating only that test's compute backend, the
  production journal writer persisted FAILED through the separate LOGIN session.
  Test predecessors are deliberately minimal; this is not full-chain evidence.
- Independent reviewer separately applied all205 actual migrations through0204
  under a restricted migration owner in `waia_test_dee958_full_197f01ae`.
  Local evidence: `/private/tmp/waia-dee958-fullchain-Xglowr/result.json` and
  `migrations.log`; SQL hashes bind the migration inputs. This validates DDL/role
  compatibility, not scientific runtime qualification.

### Remaining gates / deployment prerequisites

Final frozen-head review and integration of unpublished0203 dependency remain.
Frontend diagnostics are separate DEE-959. No production backup, migration,
deployment, runtime requalification, full-corpus experiment or Human approval
has been performed by this task. Historical-test readiness is not asserted.
