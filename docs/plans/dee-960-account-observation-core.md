---
integrationIssue: DEE-960
integrationTitle: "HTX account observation: recurring read-only owner and fenced projection"
branch: dee-960-account-observation-core
riskTier: T3
prPolicy: one-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, tenant-isolation, lint, typecheck, build, canon, independent-exact-head-review]
approvalGates: [human-security-review, human-merge, human-production-rollout]
state:
  status: in-progress
  prNumber: null
  prUrl: null
  blockedReason: null
provenance:
  authoritativeBase: 59aadcdf0a06d87e91708541cf2209cb38ed3584
  createdFrom: user-authorized-parallel-completion-dee-171
---

# DEE-960 — Read-only recurring account observation

## Acceptance

One account-specific recurring owner produces one exact organization/credential/account/revision
observation with component collection windows, source timestamps, completeness and safe errors.
The first local slice is an injected domain service with mock ports, not a production collector or
completed DEE-960. Shared authenticated read routes, SSE, real persistence and a separately qualified
credential-capable runtime remain required. Historical host/payment watcher are not reused.

## Existing ports inspected before implementation

- Credential rows have active/revoked state and timestamps; lifecycle replacement revokes the old
  credential. An adapter must bind a stable version to the complete relevant persisted identity,
  not invent a monotonic generation from wall-clock timestamps alone.
- Separate balances/positions/trade-history snapshots have independent IDs and syncedAt values;
  none proves a shared observation, atomic revoke fencing or a current lease generation. Their
  parsers may return empty arrays on malformed JSON; the new projection must not call that zero.
- Treasury/payment leases are boolean/time-based, own unrelated networks and lack an account
  generation token. They cannot safely arbitrate this credential-specific collector.
- Existing connector Balance/Order/Trade DTOs can be reused after strict field projection, but
  rawVenueObservation and arbitrary error strings must not enter the account observation.

## First implementation scope

New `lib/trader/account-observation/types.ts`, `service.ts`, and focused unit tests. The integrator
approved the necessary fifth file, `docs/ai-trader/reality-v2-source-consumer-inventory.json`:
an anchored rule matching only these two normalized-DTO consumers, classified observation-only
with no canonical authority, and mechanically derived consumer pins (124 to 126). Source rules,
154 source paths, 25 connector references, canonical kinds and ingress boundaries stay unchanged.
A focused regression in the existing consumer-graph test (sixth file, including its derived count
assertion) checks exact classification and absence of Reality ingress/venue writes.
No schema, route, historical host, deployment or existing lifecycle adapter change in this slice.

Repository port requires atomic claim-if-due with active exact binding and a unique lease token;
current-binding/lease check before each read; atomic commit-if-current that rechecks credential
status/version, account, organization, collection configuration and lease ownership/expiry.
The same atomic commit advances due time/failure count and releases ownership. A rejected fence
never publishes fetched data. Releasing an obsolete token cannot release a successor lease.
Database I/O deadlines and recovery are adapter obligations; domain mocks do not establish them.

Read connector port exposes only balance, open-order and explicit-symbol trade reads plus disposal.
No submit/cancel/amend or full exchange connector authority is passed. All requests are bounded by
an injected clock/timeout and abort signal. Next due time/backoff is persisted through the port,
so constructing another service instance does not reset it. A runtime scheduler invokes tick;
there is no browser dependency and no detached runtime is started here.
Opening the reader is also bounded and abortable. A reader arriving after timeout/cancellation
is disposed exactly once; a classified late disposal error remains attached to the primary failure.
Repository-open/cleanup failures never authorize a data commit; secondary cleanup diagnostics do
not replace the primary failure. Retry cadence after failure to open the reader, as distinct from
a completed observation with failed components, remains an adapter/runtime integration obligation.

Successful empty arrays mean observed zero rows; errors/malformed/incomplete results remain typed
missing/partial, never substituted with prior components. Holdings derive only from this observation's
balances; no strategy position, cost basis, PnL or equity is fabricated. Even complete reads are not
claimed as an atomic exchange snapshot: per-component source time and local collection window remain.

## Storage/runtime design gate

Before any material storage boundary, report the need for an additive observation + account lease/
revision schema with transactionally shared credential-revocation fence. Existing separate snapshot
stores are not presumed coherent. No migration number, SQL or runtime adapter is approved here.
Future PostgreSQL adapter must prove RLS, concurrent claim/revoke/rotate/commit serialization and
restart recovery on actual local PostgreSQL. Mock atomicity is not that evidence.

## Tests and validation

Mock/fake-clock cases: wrong organization/credential/account/revision, revoked before/after reads,
rotation and configuration change, duplicate collector, expired/stolen lease,429/timeout/backoff,
restart with shared repository, partial component errors, malformed payload, missing versus actual
zero, symbol-bound trades, disposal and no late commit. Negative compile-time port shape excludes
venue write methods. Exact production auth/route/SSE tests deferred with their implementation.

Run focused unit, lint/typecheck/build and canonical checks before local handoff; no redundant full
local unit run. Preserve all failed reproductions and describe mock versus actual evidence.

## Do NOT

No private credentials, real HTX/network/account access, live trading, orders, capital, blind holdout,
production writes, push, merge or deployment. No automatic trading stop or disconnect on UI logout.
Trade metadata does not prove transfer prohibition. No weakening tenant or Human authorization.

## Verification results

First local core has 46 fake-clock/mock-port tests PASS. Full typecheck and Next production build
PASS (16/16 static pages). Initial test-only generic inference error was corrected; canonical
validation initially rejected the nonstandard acceptance heading, corrected without weakening the
validator. Final targeted lint PASS with zero warnings; canonical validation passes all 8 regression
cases, 137 documents and 3 release-identity contracts. `git diff --check` passes. There was no runnable prior
collector to benchmark; source inspection establishes that existing independent snapshot writes
lack this coherent observation/fence port, not that real PostgreSQL serialization is now proven.

DEE-960 remains In Progress and cannot close on domain mocks alone. Missing: actual credential
revision definition, additive transaction/RLS adapter and its real database tests, bounded database
I/O, authenticated shared read routes/stream parity, runtime scheduler/capacity and separate account
admission. No current image/production behavior changed.

Reality source/consumer gate initially refuses the new consumer paths (zero matching rules).
Integrator approved the exact observation-only exclusion and derived pins after reviewing this
failure. No validator, source admission boundary or scientific rule may be weakened to mask it.

Final focused suite: 51/51 PASS (46 account-observation plus 5 Reality graph tests). The graph gate
now passes with 154 sources, 126 consumers, 25 connector references. Independent discovery and HEAD
blob hashing reproduced the original 124-consumer path/content digests and confirmed that only
`account-observation/service.ts` and `types.ts` were added. New path digest is
`e76db0804a5b5a0d6d0cfc18750ed6e1479f7d938303f34d98d7f44bf9009832`; content digest is
`ab54ea1e7741d4471688e9db5bd7252eb422426b16b631635c03cc048f71fe43`.
The new graph regression initially mistook an injected callback named `fetch` for global network
access; its AST lexical-binding check now distinguishes them without changing production code.
Typecheck, targeted lint, canonical and release-identity checks and diff whitespace checks were
rerun successfully after the inventory/test change. No production source changed since the
successful Next build. These checks do not establish runtime adapter, PostgreSQL/RLS or live readiness.

Independent review of local head `15f11f5` identified a claim error-boundary gap: `claimDue`
rejection preceded the classified catch, and copying a malformed returned binding preceded token
cleanup. The bounded correction puts claim/normalization inside the safe boundary; cleanup uses
only original requested binding/owner and a validated returned token, never returned scope. Add
synthetic-sensitive-driver-error and malformed-binding/token regressions, retaining their initial
failures. Refresh only the mechanically changed consumer content pin after the source correction.

Five new regressions failed before the correction: sensitive claim rejection escaped raw; null
or empty-credential returned bindings failed before cleanup; invalid empty/nonstring tokens still
reached release. Corrected core now passes 51 cases. Release accepts only binding/owner/token,
avoiding fabricated expiry or failure fields when a returned lease is malformed. This defends the
injected port contract; it does not assert an existing production adapter has these failures.
Updated 126-consumer content digest:
`8d1f675e7fe1e5e36218924af58f482c007275612cfa4dbadac139356088c4b4`.
Post-correction verification: 56/56 focused tests PASS (51 core, 5 graph), typecheck and targeted
lint PASS, inventory PASS with unchanged source/path/reference boundaries, canonical 137 documents
PASS and diff check PASS. Next build was last run before this narrow correction; no repeated build
or real database/runtime acceptance is claimed for it.
