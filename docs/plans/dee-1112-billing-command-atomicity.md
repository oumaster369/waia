---
integrationIssue: DEE-1112
integrationTitle: "Make legacy billing commands atomic and enforce manual approval inputs"
parentIssue: DEE-638
branch: dee-1112-billing-command-atomicity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: integration-readiness
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Controller completes serial readiness, rebases onto accepted main retaining every native suite, and publishes for exact-head CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1112 — Atomic billing commands and manual approval inputs

## Defects and bounded correction

D21: the PostgreSQL `close-and-materialize` administrative handler built
pool-backed services without an encompassing transaction. Closing an OPEN period,
its audit, the conditional automatic draft and draft audit could commit separately.
The native RED test on accepted base `55bcefa4` injected failure before close audit
and proved the actual handler left a CLOSED period with changed equity, PnL and
digest. A normal retry refused the already CLOSED period. Materialize-only cannot
reconstruct the missing close audit.

Independent root and reviewer probes also reproduced a related boundary defect:
legacy invoice approval/cancellation metadata, and issued status/HWM/audit, could
commit separately. The shared attestation predicate accepted truthy strings and
numbers; HTTP input could override server cooling-off. These are implementation
violations of the existing manual-approval contract. No production incident is
asserted and no historical records are repaired.

## WP-1 — Close and automatic draft in one held transaction

Wrap the actual PostgreSQL close command with `runWaiaPostgresTransaction` and
construct the existing orchestrator from its transaction-bound runtime, including
admin access checks. Period, HWM, fee, draft and audit collaborators use that same
executor. Exceptions escape the callback before existing HTTP error mapping.

The boundary includes conditional HWM bootstrap and period opening performed by
this command. Preserve conditional OPEN update, canonical receipt admission,
full-history guards from DEE-1109, normal CLOSED-repeat refusal and expected
nonbillable behavior: valid CLOSED plus audit, with no invoice.

Native acceptance calls the real handler with database-backed permissions and
services; it tests rollback after period UPDATE, before/after close audit, after
draft INSERT, before/after draft audit, and bootstrap/open failure. Retry creates
one valid result with finality=false and unchanged fee calculation. Two genuinely
contending connections produce one close and the normal loser refusal. Wrong-org
receipts and unauthorized users cannot mutate either tenant.

## WP-2 — Invoice command transaction, serialization and input boundary

The PostgreSQL legacy `approve`, `cancel-pending` and `issue` commands each use one
held transaction. Every service collaborator, including membership and audit, is
bound to its executor. SQLite service composition remains unchanged. Unexpected
persistence/audit failures roll back; specified canonical-digest/HWM business
refusals commit the service's intentional stale-approval invalidation, matching
the existing console behavior.

Both legacy and console commands lock the scoped invoice row. Approval and issue
then lock that org/account's stable existing HWM BOOTSTRAP row in that order; a
missing or ambiguous anchor refuses these financial commands. Cancellation needs
only the invoice lock and remains available when the HWM anchor is absent. Both command transactions explicitly use READ COMMITTED,
so post-wait service reads observe a committed HWM change even if the session
starts with a REPEATABLE READ default. The existing console transaction, revision,
manual confirmation and permissions remain in place. This lock protocol covers
these two administrative surfaces, not independent correction writers or every
standalone service caller.

The shared attestation predicate requires all six own properties to be literal
`true`, safely rejecting malformed runtime values. Legacy HTTP input validates
string fields, strips unrelated fields from the internal command object (including
an untrusted `status` key), and refuses any `cooling_off_ms` property. Existing
server configuration/default and trusted internal test clock/override remain
unchanged; no new cooling duration or authority is introduced.

Native acceptance injects failures before/after approval and cancellation audit,
after invoice UPDATE, before/after HWM INSERT and before/after issuance audit.
Snapshots prove rollback, valid retry and duplicate issuance without extra HWM or
audit. Concurrent same-invoice retries and different-invoice legacy/console
commands are held behind a real third connection; `pg_stat_activity` proves both
request connections block. The account race must commit one issuance and refuse
the outdated other command, clearing its approval. Separate controls verify stale
approval invalidation on each surface, console stale revision, absent lock anchor,
tenant/permission refusals, missing-anchor cancellation on both surfaces,
issue/cancel contention and unchanged server cooling-off.

## Validation and limits

Author validation uses a separate loopback synthetic database with real native
Postgres. New tests leave synthetic rows and remove their own failure triggers. The
missing-anchor cancellation control deliberately deletes its random synthetic
bootstrap row; no protective trigger is disabled or bypassed. Synthetic test
receipts and approval fixtures do not attest production sources or finality.
Focused unit suites cover lifecycle, draft hook, close orchestration, full-history
completeness, issuance, manual input, route auth and console automation boundary.

Root owns serial lint/typecheck/build, canon/governance/consumer graph/preflight,
mandatory CI registration, independent review and exact-head checks. Existing
reporting-period parity requires its canonical `waia_validate` profile; the new
suites do not weaken that guard to use their separate database.

No rate/HWM formula/threshold, financial receipt/finality, authorization policy,
settlement, migration, retrospective audit, production invoice execution, venue
operation, C3 action or live activation. Low-level factories are not labeled
universally atomic. Fault rollback is not proof of process-crash recovery or
ambiguous-commit resolution. Pre-existing legacy authorization-failure runtime
disposal behavior is outside this correction; native helpers close their own
clients and do not establish an all-path resource-disposal claim.


## Controller integration acceptance

On base55bcefa4, all11 registered critical PostgreSQL suites execute207 tests
with zero skips. The31 new billing cases are included, not added again to that
total. Canonical reporting-period parity and admin billing idempotency add2
companion tests. Both new suites are registered in workflow paths, the critical
job and executed-proof guard; the guard has12 passing cases.

The author ran56 focused unit tests. Independent implementation review on3e36de47
has no open findings. Root corrected two type-only annotations exposed by the
full compiler: the command callback uses the existing runtime dependency return
type and the synthetic draft fixture accepts string account IDs.

This evidence is base-specific. If another accepted PR adds critical suites
before publication, retain those suites and revalidate the final integration.
