---
integrationIssue: DEE-1108
integrationTitle: "Fenced noncapital cycle receipts and process recovery"
parentIssue: DEE-639
branch: dee-1108-noncapital-cycle-recovery
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres-process-recovery, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
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
  nextAction: "Local readiness and independent review passed; require all exact-head PR checks."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1108 — Recorded noncapital cycle recovery

## Contract

The existing ordinary canonical cycle already refuses unavailable qualification
with explicit NO_TRADE reasons. Its file shadow journal does not establish a
Postgres owner or a durable transactional completion boundary. This package adds
an isolated local/CI composition for inert recorded bars only. It does not
complete the recurring runtime, qualify a source/strategy, or enable a host.

The owner accepts only data: organization, account, complete recorded bar and
caller-recorded release SHA. It constructs the existing CONTEXT_UNAVAILABLE paper
arm itself; there is no injected capital/source/venue callback. No unavailable
RuntimeContext, Reality, qualification or Navigator identity is fabricated.

The existing organization control-lease heads/history and advisory lock637 are
reused. The separate operational adapter reads PostgreSQL clock_timestamp after
acquiring that lock, derives the epoch digest and explicit bounded duration,
and refuses active owners. There is no lease renewal: expiry is required before
the next epoch, which references its predecessor. Existing caller-supplied
trusted adjudication/replay APIs and historical PIT semantics are unchanged.
An operational lease never grants capital authority.

## WP-1 — One verifiable durable result

Migration0218 adds a tenant-scoped, append-only recorded noncapital receipt table.
Its natural key includes account, symbol, interval and closed-bar PIT; multiple
intervals may close at the same time. Exact recorded bar and supplied release SHA bind
input identity. The supplied SHA is metadata, not attestation of the executing binary. The immutable receipt contains actual canonical NO_TRADE reasons
and the committing owner epoch. Same-key changes refuse instead of overwriting;
identical replay returns the saved receipt, including after reconnect.

The owner serializes on the existing organization lock and samples database time
before work and before transaction completion. An additional deferred PostgreSQL
constraint trigger rechecks holder and actual clock at outer transaction commit
under the normal deferred setting; callers must not force constraints immediate. It is
a transaction-boundary guard, not a post-commit durability attestation. With that setting,
an expired lease cannot be rescued by staging a write earlier in a transaction.
Process death before commit rolls back; death after commit returns the same
receipt on recovery. No exactly-once external-effect claim is made because this
owner cannot invoke external effects.

The ordered-prefix helper acknowledges only the supplied sequence. It does not
infer stream completeness, scientific progress or a qualified market frontier.
Each receipt commits separately, so restart resumes through identical receipts.
Invalid ordering is rejected before any writes. Unprocessed suffixes remain
unacknowledged on failure.

## Files and constraints

- `lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2.ts`
- `lib/trader/runtime-v2/noncapital-cycle-{receipt-v2,owner-postgres-v2}.ts`
- `db/schema.postgres.ts`, migration0218 and journal
- Focused receipt unit tests, native owner integration tests, isolated child-process helper

No live/host entry point, credentials, venue access, production migration/lease,
C3 worker change, capital callback, RuntimeAuthorityAssessment fabrication,
scientific timing threshold, Risk TTL, financial rule or qualification alteration.
No historical ratification/checkpoint artifact is repurposed.

## Acceptance

- Actual two-process lock contention has one owner; queued owners sample DB clock after lock acquisition.
- Exact input/release conflict refusal, interval separation, tenant isolation, immutable replay and reconnect.
- Active owner cannot renew; expiry and successor epoch fence old owner.
- Expiry between staging and outer commit rolls back under deferred database fencing.
- Kill a real process before commit, observe zero rows, recover under successor epoch.
- Kill a real process after commit before acknowledgement, recover exactly one saved receipt.
- Actual append-only and anon/authenticated denial; existing deterministic RuntimeAuthority tests remain passing.
- Targeted unit/native PG suites, standard local readiness and all exact-head CI before merge.

Native tests require WAIA_PG_INTEGRATION=1 and a loopback DATABASE_URL_POSTGRES.
Skipped native cases are never acceptance. All fixture identities are synthetic;
actual PostgreSQL/process evidence is not external source or live qualification.

## Local bounded acceptance, 2026-09-26

45 targeted cases across5files passed, including17 actual PostgreSQL cases
(new8 process/owner cases and existing9 deterministic RuntimeAuthority cases),
with zero skipped native cases. All tests used isolated loopback54329. Migration0218
applied to the existing throwaway fixture; the final trigger definition was
reapplied locally during review. Complete empty-database migration application
remains a required CI check. Scoped ESLint and diff whitespace checks passed.

The initial browser-role test incorrectly caught a permission error inside an
aborted transaction; that test fixture was corrected to transaction-local CRUD
grants with actual RLS assertions and rolled-back grants. No product guard was
relaxed. Whole PR lint/typecheck/build/governance and exact-head CI remain pending
root integration. No production DB, runtime owner or C3 worker was touched.

## Root integration acceptance

The original author results above are superseded by completed integration checks:
all migrations, including0218, applied successfully to a new empty loopback
database `waia_dee1108_fresh`. The ten critical PostgreSQL suites then executed
184 passing tests there, zero skips. The new process suite is mandatory in the
existing CI job and executed-proof validator; the other nine suites remain
required. The validator's11 positive/negative tests also pass.

Full lint (zero errors), typecheck, build, canon, PR governance and both consumer
graph validators pass. Independent review found no implementation blockers.
These checks accept the bounded local/CI substrate only. Exact-head PR CI and
merge are still pending; no production migration or host wiring is performed.

Migration memory:0218 is additive, Postgres-only and not deployed automatically.
It reuses the existing lease history and append-only guard. The schema requires
deny RLS for browser roles. Rollback of this inert code requires no receipt
deletion; retain append-only evidence and stop the test owner. Production
application is a later explicit deployment step when an accepted owner needs it.
