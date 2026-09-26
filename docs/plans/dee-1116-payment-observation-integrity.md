---
integrationIssue: DEE-1116
integrationTitle: "Complete payment observation and exact atomic amounts"
parentIssue: DEE-638
branch: dee-1116-payment-observation-integrity
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
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: c9554acd29ae8ffcd3b8fe05c06033661686bf42
  lastValidationAt: "2026-09-26T14:09:02.542967+00:00"
  blockedReason: null
  nextAction: "Obtain accepted-base delta review; controller completes final readiness and exact-head CI before publication."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1116 — Payment observation integrity

## Problem and evidence boundary

At base `ded58378b57b1cdc869f495905dcdf4d9a52d791`, the payment observer
requested one event page with undocumented block-range parameters, accepted
application-error bodies as empty success, converted atomic token units through
`Number`, and ignored explicitly requested confirmation quorum. Independent
offline reproductions executed the actual RPC client, adapter and watcher with
synthetic transport/persistence ports. They did not establish any production
missed payment or financial loss.

The [official contract-events endpoint documentation](https://developers.tron.network/reference/get-events-by-contract-address),
checked 2026-09-26, documents a specific `block_number`, pagination by
`meta.fingerprint` while retaining all other parameters, and page limit 200.
There is no documented `min_block_number`/`max_block_number` pair. The existing
Treasury observer provides a local pagination precedent but remains a separate,
unchanged consumer.

## WP-1 — One complete observation or an explicit refusal

The payment adapter snapshots its configuration, validates the requested range
against the existing configured block limit, and enumerates each exact block.
Every continuation reconstructs the same configured contract and query, adding
only the opaque fingerprint. Returned next URLs are never followed. The existing
`only_confirmed=true` behavior is preserved in this repair.

Acceptance requires `success:true`, an array of at most 200 rows, object
metadata, and valid continuation. A full page without a fingerprint or a next
link without a fingerprint is ambiguous and refuses. Each block has an
independent seen-fingerprint set and a fixed operational bound of 20 pages:
terminal page 20 succeeds; a continuation after it refuses. Empty intermediate
pages do not terminate a supplied continuation. A repeated cursor, malformed
response, later-page failure, or later-block failure yields no successful
partial range.

Each event must carry the queried block, configured contract, Transfer identity,
transaction ID, nonnegative safe event index and block timestamp, valid address
fields, and unsigned decimal atomic units. Missing fields do not become zero,
index zero, or the current time. An identical repeated transaction/index is
deduplicated; conflicting content for that identity refuses the entire range.
Amounts use integer quotient/remainder with exactly six decimals, including
values above Number's safe-integer range. No money passes through Number.

The tip and every event page must come from the same provider. The watcher also
checks its outer tip provider against the completed adapter result before the
owner/payment loop. A whole observation may fail over to the secondary; mixed
observations refuse and await a subsequent cycle. This is consistent-source
observation, not independent-provider agreement or a scientific finality proof.

The watcher checks explicit `confirmQuorum=true` before checkpoint access or RPC,
returns `noop_unsupported_configuration` with
`WATCHER_CONFIRM_QUORUM_UNSUPPORTED`, and produces no payment or progress writes.
Disabled precedence and accepted primary-only false/default behavior remain.
Full hardened quorum is separately deferred under ADR-0015.

## Files and invariants

- `lib/waia-core/payment-watcher/tron-adapter.ts`
- `lib/waia-core/payment-watcher/run-watcher-cycle.ts`
- `lib/waia-core/payment-watcher/watcher-cycle.types.ts`
- `tests/unit/payment-watcher-observation-integrity.test.ts`
- Existing adapter failover control updated to require a consistent secondary observation.

No shared RPC client, Treasury adapter, financial rate, HWM, settlement method,
finality depth, rescan/window/block-limit default, address lifecycle, ledger
idempotency, tenant attribution, schema or production configuration is changed.
No cursor rewind, historical reconciliation, payment repair or audit backfill.
No chain transaction, provider invocation, credentials, host action, trading
activation or C3 action. This package does not fix manual reconciliation's
lexical amount comparison or its separate cooling boundary.

## Acceptance and limits

The new suite uses the actual RPC client, adapter and watcher, with fetch confined
to immediate synthetic `.invalid` responses and instrumented persistence ports.
It covers complete cross-block pagination before effects, late failures, strict
response/identity checks, 20-page boundaries, cursor cycles/reset, unchanged
query identity, ignored hostile URLs, duplicate/conflicting events, provider
drift at every boundary, consistent secondary failover, exact large amounts,
malformed units/ranges, unsupported quorum, disabled/depth/owner controls, and
immutable configuration. This is not native persistence or a production probe.

Initial RED before implementation: 46 failed / 1 passed in the new 47-case
suite, with the adverse implementation behaviors reproduced. Further controls
were added during review; author GREEN and companion evidence are recorded in
the external DEE1116 handoff. Existing SQLite ledger-backed unit companions
exercise persisted idempotency, tenant resolution, reorg and checkpoint
behavior; they do not establish PostgreSQL or provider acceptance.

Targeted commands:

```sh
pnpm test --run tests/unit/payment-watcher-observation-integrity.test.ts tests/unit/payment-watcher-tron-adapter.test.ts tests/unit/payment-watcher-confirmation.test.ts tests/unit/payment-watcher-normalize-network.test.ts
pnpm test --run tests/unit/payment-watcher-cycle.test.ts tests/unit/payment-watcher-checkpoint-repository.test.ts tests/unit/payment-watcher-stale-lease-recovery.test.ts tests/unit/health-payment-watcher-route.test.ts tests/unit/treasury-watcher-adapter.test.ts
pnpm exec eslint lib/waia-core/payment-watcher/tron-adapter.ts lib/waia-core/payment-watcher/run-watcher-cycle.ts lib/waia-core/payment-watcher/watcher-cycle.types.ts tests/unit/payment-watcher-observation-integrity.test.ts tests/unit/payment-watcher-tron-adapter.test.ts
```

The root controller owns full lint/type/build/canon/governance/consumer-graph
readiness, independent acceptance, PR publication and all required exact-head CI.
No full local unit-suite duplication is required. This plan remains in-progress
until those gates are completed.

Bounded enumeration can require up to `20 × configured maxBlocksPerCycle` event
requests, plus tips and existing retries/failover; at the unchanged default this
is at most 4,000 event-page iterations. This is a termination bound, **not** a
Worker subrequest, lease-duration, throughput, or provider availability
qualification. Returning an explicit incomplete observation can stop cursor
progress; it must never be relabeled as complete. Actual deployment capacity,
provider contract operational acceptance, hardened quorum and broader P08
closure remain open. No production health or live-readiness claim follows from
these tests.

Root local acceptance on base `ded58378`: 94 targeted tests in nine files, full
lint, typecheck, build, canon, governance and both consumer graphs pass.
Two test callback inference errors were corrected with return-type annotations;
the original compiler failure is preserved. Independent review of the unchanged
production source and 55 additional inert cases found no blocker in this scope.
Final base integration, exact-head CI and merge remain outstanding.

The existing Worker discards the returned cycle report. Unsupported quorum logs
its explicit reason, but existing health derives from checkpoint recency and
can remain healthy until that checkpoint becomes stale. This repair does not
claim health/UI/alert-reason coverage or change their consumers.

### Accepted-base integration — 2026-09-26

The independently reviewed root candidate is
`74a25a95676cda79fa1b32c268790a85f0858b1d`. Local merge
`f9418e18a839503e6857bc40341498e2fe634096` incorporates exact accepted main
`ed2a25f72008a97211c9454fd29d4f62a65508b2` without conflict. The six reviewed
author paths and 11 incoming billing/CI paths do not overlap. Blob comparisons
and binary diff equality in both directions prove unchanged author and incoming
patches at the merge. This later supplement changes only the canonical plan.

Scoped acceptance passes the original 94 cases across nine files plus 13 incoming
proof-guard cases: 107 tests across ten suites, zero skips. Scoped ESLint and
diff checks pass. The 12 mandatory native PostgreSQL suite registrations and
their test blobs remain identical to accepted main. No native PostgreSQL test is
run or claimed by this integration; existing isolated SQLite unit fixtures are
part of the scoped companion evidence only.

Explicit unsupported quorum refusal, the default primary-only mode and the known
4,000-page capacity and health-consumer limits above are unchanged. Earlier full
readiness applies to the earlier base/head. Current delta review, controller
readiness and final-head CI remain required; these scoped results do not qualify
provider operations, scientific authority, settlement or live readiness.

### Accepted-base refresh to 2565e1a2

Normal merge `cdc07f8286879d101d59b159d62215d2a74cd146` incorporates exact
accepted main `2565e1a23741d0042096fd8209cd9793e8aa7e19` into reviewed
`cdfdcbe28212f36ec8e570015a01d21011c242bf`, without conflicts. All six author
paths and six incoming PR675 paths retain their exact blobs at the merge;
complete binary patches are unchanged in both directions. This final record
changes only the canonical plan. The five author production/test files and all
incoming paths remain unchanged, including the 13 mandatory native suite
registrations and their source blobs.

At that merge head, **108 targeted unit assertions / 10 files PASS, zero skips**:
the original 94 watcher/Treasury/health companion cases plus the current 14
proof-guard cases. Scoped ESLint and diff whitespace checks pass. Commands,
JSON assertion results and source-preservation evidence are recorded separately
under `evidence/dee-1116/accepted-base-2565e1a2/`; author logs do not overwrite
prior root evidence. No PostgreSQL or real provider/network operation ran in
this refresh. Native registration preservation is not native execution proof.

Prior full readiness remains attributed to the earlier reviewed base/head.
Current independent delta review, root full readiness and final-head CI remain
required. No production, provider-capacity, lease, health-reason, settlement,
scientific or live-readiness claim changes. Treasury remains a separate observer.


### Accepted-base refresh to 1a59b31b

Normal merge `c9554acd29ae8ffcd3b8fe05c06033661686bf42` incorporates exact
accepted main `1a59b31b620af81b727d28b24f3ddbf9cb953074` into independently
reviewed `ff7006ef86147ce460d992371fa2bbe42604d60e`, without conflicts or
manual resolution. The six author paths and 14 incoming paths are disjoint.
All retain exact source blobs at the merge, and the complete binary patches
are unchanged in both directions. This acceptance supplement changes only the
canonical plan; the five author production/test blobs remain unchanged.

At the exact merge head, **110 targeted assertions / 10 files PASS, zero skips**:
the original 94 watcher/Treasury/health cases plus 16 current executed-proof
guard cases. Scoped ESLint and diff checks pass. All **15** mandatory native
suite registrations and source blobs retain accepted-main identities; workflow,
proof guard and guard-unit suite lists agree in order. Registration preservation
is not native execution. No PostgreSQL or real provider/network operation ran.
Commands, raw author logs, assertion JSON and exact preservation manifests are
recorded under `evidence/dee-1116/accepted-base-1a59b31b/`, separately from prior
root and author evidence.

Full lint/typecheck/build, native PostgreSQL, independent delta acceptance,
rendered PR governance and final-head CI are not claimed by this scoped refresh;
root retains those integration gates. Explicit quorum refusal and accepted
primary-only behavior are unchanged. The 4,000-page capacity bound and existing
checkpoint-age health-consumer limitations remain; this does not qualify
provider availability, settlement, financial completeness or live operation.
