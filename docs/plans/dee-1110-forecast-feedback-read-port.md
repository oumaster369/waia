---
integrationIssue: DEE-1110
integrationTitle: "Replay exact persisted Forecast terminal feedback"
parentIssue: DEE-639
branch: dee-1110-forecast-feedback-read-port
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
  lastValidatedGitSha: 111fd1ed17d17084c4250b7053c216f6b9b8e966
  lastValidationAt: "2026-09-26T12:06:03.343Z"
  blockedReason: null
  nextAction: "Accepted-base native and scoped checks passed; obtain independent integration review and root full readiness before publication and exact-head CI. No runtime activation."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1110 — Exact durable Forecast feedback reader

## Problem and result

The existing Forecast V2 terminal closure writer atomically saves objective
outcome, calibration and future Knowledge evidence. Its digest/count readers do
not reconstruct the complete chain after restart. Add one server-only exact
reader, reusing saved package wire hydration, Forecast replay, the existing
calibration scorer and the zero-delta Knowledge builder.

`readForecastV2FeedbackPostgres` accepts an authorized organization context,
explicit bundle/terminal-Forecast/package/Knowledge-idempotency references,
symbol and exact future run/cycle/PIT. It copies the caller's references before
its first await, owns one REPEATABLE READ READ ONLY transaction and returns the
replayed evidence-only data or a typed refusal. It has no write/capital callback
and is not wired into ordinary paper/live execution.

## WP-1 — Exact saved sources and replay

1. Match tenant, bundle, terminal role, package, symbol, issuance anchor,
   persisted schema versions, generation/distribution/content identities and
   package shape. Reject historical package provenance and historical authority
   fields from this ordinary reader; the existing historical path is unchanged.
2. Hydrate the saved authorized outcome through the existing immutable package
   wire and replay its existing validator. Do not treat transport hydration as
   admission or invent the missing ordinary qualification tuple.
3. Score saved objective evidence again. Compare the saved outcome projections,
   complete calibration payload, scores, probability vector and their digests.
4. Rebuild the future Knowledge record from the saved prior/provenance and
   replayed calibration. Validate its complete persisted body, its independently
   derived ID and key, and canonical nonnegative safe-integer sequence. The
   existing Knowledge content digest alone does not cover ID/idempotency key.
5. Require the exact saved future anchor and a strictly earlier objective
   resolution. Before that anchor return NOT_YET_VISIBLE; a later unmatched
   cycle is an identity mismatch, not implicit authority propagation.
6. Preserve EVIDENCE_ONLY, PENDING, zero delta and all downstream capital,
   strategy, trade-eligibility and Guardian authorities NONE.

The Knowledge JSON key `forecast_outcome_content_digest_hex` contains the
**observed outcome digest**, not the outcome table's independent `content_digest`.
The reader compares each to its actual existing contract.

Supported objective payloads use the canonical durable producer's
`computeSemanticSha256Hex(objectiveEvidence)` content convention. The lower-level
writer intentionally supports other supplied content digests. Such valid legacy
layouts return UNSUPPORTED_OUTCOME_DIGEST_LAYOUT here; the writer remains
unchanged. Null saved payloads return LEGACY_PAYLOAD_UNAVAILABLE. Missing rows,
corruption, wrong namespace and identity mismatches are separately typed.
Database/connection failures propagate as operational errors, without being
reported as corrupt saved data. Refusals contain no saved payload or error text.

## Native acceptance and limits

The dedicated native suite persists synthetic data through the real package,
contract, Forecast and terminal-closure writers. Its 11 cases cover:

- Exact reconstruction after creating a new connection and in a real child
  process; no mocked Forecast or package validator.
- Tenant, bundle, terminal member, package, symbol, Knowledge key and future
  destination separation; exact visibility and noncanonical timestamp refusal.
- Missing outcome/calibration/Knowledge and absent legacy objective/calibration
  payloads; explicit unsupported objective digest convention.
- A real persisted historical-package graft, refused before ordinary feedback.
- Inconsistent inserted nested calibration content and rehashed Knowledge source
  substitution; independently incorrect ID and noncanonical key sequence.
- Two native connections: a reader establishes a snapshot, a real closure writer
  commits, and the first reader still sees coherent pre-commit absence. A fresh
  read sees the complete closure.
- Actual transaction settings plus a deliberately attempted write on that same
  transaction, rejected by PostgreSQL with SQLSTATE 25006; caller-reference
  mutation during a read does not alter the captured identity.

The new suite never disables append-only triggers or deletes another suite's
rows. Deliberately inconsistent cases use INSERT-only synthetic fixtures and
leave all existing guards enabled. Synthetic append-only rows remain in the
disposable local/CI database. The companion legacy suite retains its existing
fixture cleanup behavior; none of its source or expected behavior changed.

Local implementation-tree acceptance on 2026-09-26: **17 actual PostgreSQL
tests / 2 files PASS, zero skipped**: 11 new cases and all 6 existing Forecast
persistence cases. The new process test completed successfully. The database
was a separate local `waia_dee1110` clone of the fresh validation schema, with
loopback guards on both the suite and child reader. Local release metadata was
the checkout base `ebff133563273399ea86162cf81d5b9e5e929868`; this is supplied
test metadata, not release or deployed-binary attestation.

Validation command, with the existing loopback validation profile and
WAIA_PG_INTEGRATION=1 / WAIA_POSTGRES_CLI=1 / WAIA_TRADER_CLI=1 / WAIA_RELEASE_SHA
set to the tested checkout identity:

```sh
pnpm test --run --no-file-parallelism tests/integration/postgres-forecast-v2-feedback-read-port.test.ts tests/integration/postgres-forecast-v2-persistence.test.ts
```

Path-scoped ESLint and `git diff --check` pass. Full lint/typecheck/build,
governance/canon and explicit native CI inclusion remain the integration
controller's serial checks; local acceptance is not a claim that PR CI passed.
Initial native fixture attempts exposed missing test release metadata, misuse
of the transaction-required Knowledge repository, a wrong compact schema code
and instrumentation that converted SQL fragments into promises. These fixture
issues were corrected without weakening production guards.

## WP-2 — Integration acceptance

Independent review accepted implementation commit `4deb5d39` with no findings.
The integration controller added explicit native CI coverage for the reader,
both helper files, outcome-resolution source and Knowledge update source. The
existing executed-proof guard also requires the reader suite and its existing
Forecast persistence companion; missing/skipped/failed evidence is rejected.

On the original `ebff1335` base, all **193 native PostgreSQL tests / 11 suites**
passed with zero skips, including the nine existing critical suites and both
Forecast suites. The executed-proof guard and its 12 positive/negative unit
cases passed. Whole-repository lint (existing warnings only), typecheck, build,
canon, governance and both consumer-graph validators passed. Test release
metadata was `4deb5d39`; these are implementation-tree checks, not PR CI or a
deployed release assertion.

### Accepted-base refresh

Merged accepted main `ed2a25f72008a97211c9454fd29d4f62a65508b2` into the
independently reviewed integration head `169c121e`, producing code head
`4c51787597dbd0d4355cf1605bd9b668978e584d`. The only conflicts were the three
mandatory-suite lists/counts in the workflow, proof guard and guard unit test.
Their additive union retains all twelve incoming suites and both Forecast
suites, for fourteen required native suites. No skip waiver is introduced.

All 32 nonconflicting incoming files retain their exact accepted blobs,
including migration0218, its journal/schema compatibility correction and the
billing command fixes. The production reader, both helpers and native suite
remain byte-identical to the previously reviewed implementation. The canonical
plan is the only subsequent evidence/documentation change.

Fresh local database `waia_dee1110_ed2a25f7`, PostgreSQL16.14, applied all219
migrations from an empty database. At code head `4c517875`, **232 native tests /
14 mandatory suites PASS, zero skips**, with the executed-proof guard passing.
This includes both Forecast suites and all twelve accepted-base companions.
**126 unit tests / 10 files PASS**, covering the guard, Forecast authorization,
wire identity, symbol binding, calibration, outcome resolution, evidence-only
Knowledge update, future-cycle effect and migration identity. Scoped ESLint and
accepted-base diff whitespace checks pass. Final database readback has zero
other sessions and zero disabled public user triggers; synthetic fixtures are
retained, with no existing fixture/registry repair. Test release metadata is
the code head, not attestation of a deployed binary.

The prior whole-repository readiness results above apply to the original base;
full readiness on this combined base remains the integration controller's next
step. Source-preservation and exact commands/results are recorded in the audit
artifact `evidence/dee-1110/accepted-base-ed2a25f7/`. Passing local checks do not
waive independent integration review, final-head CI or milestone audit.

### Accepted-base refresh after PR675

The controller subsequently completed all full-readiness checks at prior head
`e86d767da089926943a3cd0a70a2e943ae3f9d18`, and independent integration review
accepted that head. Those results remain attributed to the prior `ed2a25f7` base.

Merged newly accepted main `2565e1a23741d0042096fd8209cd9793e8aa7e19` into
`e86d767d`, producing code head `111fd1ed17d17084c4250b7053c216f6b9b8e966`.
The workflow and proof script merged additively; the only conflict was the guard
unit test's required count/name, resolved to fifteen. All thirteen incoming
mandatory native suites and both Forecast suites remain required, with
`WAIA_POSTGRES_CLI=1` retained. All 35 non-union incoming file blobs since the
original base, including the three new PR675 source/test/plan files, are exact.
The reader, both helpers and dedicated native suite still match `4deb5d39`.

At this exact code head, fresh isolated local database `waia_dee1110_2565e1a2`
on PostgreSQL16.14 applied all219 migrations from an empty public schema.
**280 actual native tests / 15 mandatory suites PASS, zero skips**; the
executed-proof guard passes. **127 targeted unit tests / 10 files PASS, zero
skips**. Scoped ESLint and accepted-base diff whitespace checks pass. Final
readback confirms zero other sessions, zero disabled public user triggers and
zero leftover `dee1115_test_fault` triggers/functions. All database clients are
closed and the local database resource grant is released. No existing database,
fixture or migration registry was repaired or changed.

Exact commands, raw logs, JSON assertions, source-preservation identities and
local database readback are retained in the audit artifact
`evidence/dee-1110/accepted-base-2565e1a2/`. Test release metadata is the tested
code head; it is not an attestation of an executing production binary. The
following commit changes only this canonical plan. Independent final delta
review, root whole-repository readiness on this base and exact-head PR CI remain
required; the local acceptance does not complete WP-2 or authorize runtime use.

## Deliberate boundaries

Content and identity replay is not trusted scientific/source admission. The
reader does not authenticate or regenerate a full runtime-input source,
qualification tuple, Understanding reconstruction, Navigator question relevance,
Knowledge version transition or nonzero epistemic effect. It does not inspect
holdout payloads or create a new promotion/live path. Evidence-only null/zero
effect behavior elsewhere remains unchanged.

No source writer, schema, migration, financial formula, risk limit, scientific
threshold, host, production database, C3 worker/mount/parameter, release or venue
configuration changes belong here. No production migration, deployment, account
binding, runtime activation or order was executed. Operator/scientific gates and
full P10 composition remain separate. The user authorized these technical work
packages; acceptance fixtures do not constitute Human scientific ratification.
