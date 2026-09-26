---
integrationIssue: DEE-1110
integrationTitle: "Replay exact persisted Forecast terminal feedback"
parentIssue: DEE-639
branch: dee-1110-forecast-feedback-read-port
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
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Independent review and serial integration readiness; explicitly include native evidence in CI. No runtime activation."
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
