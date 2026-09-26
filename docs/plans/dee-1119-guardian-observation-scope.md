---
integrationIssue: DEE-1119
integrationTitle: "Bind legacy Guardian observations to the exact cycle scope"
parentIssue: DEE-639
branch: dee-1119-guardian-observation-scope
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 0ab6d570b0bc35ea0e5f4c4a374b01117fcac9c9
  lastValidationAt: "2026-09-26T15:14:50.335844+00:00"
  blockedReason: null
  nextAction: "Current-base scoped checks pass; root coordinates fresh sixteen-suite native proof, full readiness and independent delta review before publication."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1119 — Exact legacy Guardian observation scope

## Problem and scope

On accepted main `ed2a25f72008a97211c9454fd29d4f62a65508b2`, the optional
legacy paper Guardian selects all open organization lots and applies a single
instrument's mark and MSV to them. Its exit intents use the cycle account even
for another account's lot. This can record a wrong valuation or intent before
the existing Execution V2 boundary refuses submission. It does not demonstrate
that a real order was placed. P11 continuous host composition remains open.

## WP-1 — Bind selection and observations before effects

Reuse the existing repository's exact `accountKey` and `symbol` predicates.
Ordinary market observations use the exact stored instrument identity; the
historical slash-normalization helper grants no authority to alias these rows.
Validate the cycle account, snapshot quote/bars, feature instrument and MSV
instrument before reading lots. Defensively validate all returned lots and
their referenced trades against the same organization/account/instrument and
their venue, side, instrument-kind and opening signal identities before any
exit-engine mutation, lifecycle recording or submission. Missing/mismatched
bindings refuse explicitly; no silent partial batch or invented observation.

The existing session trailing map contains no scope metadata. A scoped subset
cannot prove that an absent lot is closed. Remove the evaluator-wide prune;
update only selected, validated lots and retain other entries unchanged. This
does not qualify bounded memory for a long-lived host or repair stale session
state. It does not add a global registry, source read or closure policy.

The normal recorder creates a fresh lot ID; inserts enforce primary-key
uniqueness, and the repository update API preserves account/instrument/trade
identity. That low-level update API does not itself prohibit CLOSED-to-OPEN
state changes. Arbitrary reopening/reuse of an existing ID is not qualified by
this fix; a retained prior trailing state may remain. The pre-existing empty
batch return already retained map entries. Session cleanup and long-lived
memory bounds require their own ownership/lifecycle contract.

## Acceptance and exclusions

Actual evaluator/cycle tests cover wrong account, symbol, organization, trade,
snapshot and missing binding before records; mixed datasets retain the target
lot; HOLD, disabled and empty controls remain. Check no trailing-map mutation
on a later invalid row, and preserve unrelated entries with selected updates.
Native PostgreSQL proof uses real lifecycle selectors/recorder with mixed
accounts/instruments/tenants and the real legacy execution refusal composed
with inert dependencies. Existing SQLite cycle and Guardian/exit tests remain
companions. Never disable protective triggers or repair a migration registry.

Preserve HTR's early return, `execution_v2_required`, Guardian decision/quantity
and stop calculations, Risk/Execution contracts, fees and financial policy.
No new source authority, schema, live action, provider call, C3/host wiring or
continuous Guardian scheduling is included. Read-time identity binding is not
a transactional quantity reservation or proof of current venue exposure.

Scoped commands: `pnpm test --run tests/unit/trader-guardian-observation-scope.test.ts`
and `WAIA_PG_INTEGRATION=1 pnpm test --run tests/integration/postgres-guardian-observation-scope.test.ts`
against a guarded local synthetic database. Root coordinates broader checks,
mandatory CI registration, independent review and publication.

## Mandatory executed-proof registration

The PostgreSQL CI job retains the twelve required suites from accepted base
`ed2a25f72008a97211c9454fd29d4f62a65508b2` and adds the observation-scope suite
as the thirteenth. The executed-proof guard rejects a missing, skipped, failed,
empty or duplicate result for that suite. Path triggers include both production
modules and the shared scope fixture. This registration is not itself executed
acceptance; root records fresh combined native results and full readiness before
publication. Any subsequently accepted mandatory suite must also be retained.

## Local evidence

- Accepted base: `ed2a25f72008a97211c9454fd29d4f62a65508b2`.
- Before the production change: 39 failures / 2 passes in the initial 41-case
  focused unit regression, and 7 failures / 0 passes in the native regression.
  The native failures reach the actual cycle and actual lifecycle persistence.
- After the change: 81 unit tests in 6 files pass, including existing SQLite
  paper-cycle, Guardian evaluation/exit-intelligence, oversell and exit-builder
  companions. Extra controls cover HTR bypass, scope capture across an await,
  consistent exact identities, malformed trade binding and trailing-map state.
- Native: 7 tests / 1 file pass with zero skips on fresh loopback database
  `waia_dee1119`, PostgreSQL 16.14, after all 219 migrations. Final readback has
  zero other sessions and zero disabled public user triggers. Synthetic rows
  are retained; no existing fixture or migration registry was repaired.
- Changed TypeScript files pass scoped ESLint; diff whitespace passes. Full
  type/build/readiness and PR checks remain root-owned and are not claimed here.

The former multi-lot unit fixture assigned ETH to a lot but BTC to its trade
and observation. Its deterministic ordering control now uses two correctly
bound BTC lots, and explicit mixed-instrument refusal tests cover the old bug.
The native positive exit case calls the real execution service with inert
ports and receives `execution_v2_required`; it makes no real order or execution
qualification claim. The binding check does not establish source freshness,
PIT qualification, transactional quantity ownership, or whole-P11 readiness.


## Consumer inventory reconciliation

The unchanged Reality graph guard detects the changed content of the existing
paper-cycle consumer. Independent enumeration retains all134 consumer paths and
26 connector references; exact baseline/head blob comparison identifies only
`lib/trader/paper/paper-cycle-runner.ts` as changed. Refresh only that inventory's
aggregate content pin after reviewing the scoped selector/binding change. No
source/consumer rule, admitted boundary, connector count or path pin changes.
The validator and its regression assertions remain unchanged; both graph suites
must pass before publication.

## WP-2 — Accepted-base refresh to2565e1a2

The prior complete local acceptance and independent review apply to
`95995c8e54fe40072a860813037c76156e7c06f1` on base `ed2a25f7`: combined
222 native assertions/13 suites with zero skips, then107 units/9 files and
root full readiness. They do not substitute for current-base native acceptance.

Merged exact accepted main `2565e1a23741d0042096fd8209cd9793e8aa7e19`
without textual conflicts, yielding merge `1d411f4bdefca2749c7a33180dbb6ac6c1b178fe`.
The additive suite union has14 members: all13 incoming suites and the Guardian
observation-scope suite. Follow-up code head
`0339b5df46737e10b4b7343635d43b46b99b7ab1` changes only the guard's positive
count/name from13 to14 and explicitly adds `WAIA_POSTGRES_CLI=1` to the native
job (this flag was absent from both parents). Serial execution and the executed
proof guard remain required; no skip waiver or incoming suite was removed.

All eight non-union author files, including both production modules, native and
unit scope fixtures/tests, and the inventory content pin, retain their reviewed
blobs. All three non-union incoming PR675 files retain accepted blobs. All134
previously inventoried consumer blobs are identical to the reviewed head;
consumer paths,26 connector references and content pin remain unchanged.
No additional inventory or policy rule was edited during this refresh.

At code head `0339b5df`, **108 targeted unit assertions/9 files PASS, zero
skips**, including Guardian/cycle/exit companions, the14-member proof guard
and both graph regression suites. Scoped ESLint and diff whitespace checks pass.
Evidence is separate from earlier root logs under
`evidence/dee-1119/accepted-base-2565e1a2/`: scoped-acceptance.json,
author-unit-results.json and source-preservation.json.

After the exclusive local resource grant, fresh native acceptance ran at
`0e33e04714020a0a3c22b2effc6fd91ae00da4d0`; its only delta from the unit-tested
code head is this canonical plan. On new isolated loopback database
`waia_dee1119_2565e1a2`, PostgreSQL 16.14, all 219 migrations completed and
**270 native assertions/14 mandatory suites PASS, zero skips**. The executed
proof guard passes. Final readback confirms zero other database sessions,
zero temporary live-permission fault triggers/functions and zero disabled
public user triggers. Existing fixtures and migration registries were not
repaired. The database resource was released after all runner clients closed.

Native evidence is `native-acceptance.json`, `author-native-results.json` and
the separate author migration/native/proof logs in the same evidence directory.
The 270 native assertions are distinct from the earlier 108 unit assertions;
neither result is a full unit-suite or current-base full-readiness claim.
The final documentation-only record inherits identical tested source and tests.
Current-base independent final delta review, root full readiness and exact-head
PR CI remain required. No production, source-freshness or whole-P11
qualification is inferred.

### Accepted-base source refresh 21a60ec3

Normal merge `0ab6d570b0bc35ea0e5f4c4a374b01117fcac9c9` incorporates exact accepted main `21a60ec38573f0ca5c535992e9e09392c2aa78c9` from prior clean `b349305e`. Three conflicts were confined to the CI/proof/guard lists and resolved as an additive union: all fifteen incoming required native suites plus Guardian scope, with the positive guard expectation updated to sixteen. Serial execution, no-skips checks and CLI flags remain intact.

All eight nonunion author paths and sixteen nonunion incoming paths retain exact blobs and binary patches in both directions; final evidence changes only this plan. The incoming proof files are reconstructed exactly by removing the existing Guardian path/suite additions and the sixteen-suite count adjustment. All fifteen incoming native test bodies, original Guardian native/test/production bodies, inventory pin and all134 existing consumer blobs remain unchanged. Incoming numeric parser semantics are the accepted main repair; no Guardian decision, quantity or stop formula is changed here.

Scoped acceptance at the merge:124 tests in ten files, all passed without skips (81 Guardian/cycle/exit,12 graph regression,17 proof-guard and14 numeric controls). Scoped ESLint and diff checks passed. Evidence is `evidence/dee-1119/accepted-base-21a60ec3/`. No native/DB or full readiness was run for this refresh: prior270/14 native on2565 and prior root readiness remain historical evidence. Fresh sixteen-suite native proof and current-base full readiness require root coordination before publication. Existing trailing-state retention, session cleanup, ID-reuse, observation freshness and fullP11 limits remain unchanged. No provider, host, production, C3 or capital action occurred.
