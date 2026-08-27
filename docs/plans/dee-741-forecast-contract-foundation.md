---
integrationIssue: DEE-741
integrationTitle: "Forecast V2 content-addressed contract foundation"
parentIssue: DEE-648
branch: dee-741-forecast-contract-foundation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation:
  - focused-known-answer-and-negative-tests
  - pit-replay-tenant-idempotency-conflict-tests
  - typecheck
  - production-build
  - one-full-fresh-migrated-sqlite-suite
  - canonical-and-pr-governance
  - independent-exact-head-review
  - authoritative-postgres-and-dee-653
approvalGates:
  - human-ratified-dee-648a-contract-only-split
  - exact-head-independent-review
  - dee-653-exact-head-admission
includedIssues: [DEE-741]
state:
  status: implementing
  currentWorkPackage: DEE-741
  completedWorkPackages: []
  remainingWorkPackages: [DEE-741]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Implement the frozen contract and durable binding, then execute exact-head gates."
provenance:
  createdFrom: human-ratified-dee-648a-split
  sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
  authoritativeBase: 4fe218942cdb7f6bb0cce7f2c145404cfaa111f9
  admissionAudit: "Fresh origin/main, Linear dependency/duplicate/ownership and producer/consumer/replay/persistence/test surfaces admitted before implementation writes."
---

# DEE-741 — Forecast V2 content-addressed contract foundation

## Frozen API and invariants

1. `ForecastInputContractV2` has exactly one mathematically consumed predictor for the current champion: `anchorRealizedVol20m_1m`. Its versioned measurement identity is content-addressed. Undeclared fields cannot affect its digest.
2. `HypothesisAssessment` is represented only as an exact applicability prerequisite. It is never a predictor, never carries a confidence scalar, and cannot alter mathematical input identity.
3. `ForecastModelSpecV2` binds the exact input-contract digest, target-definition digests and model-transform identity. It does not execute, rank, score or promote a model.
4. `ForecastModelArtifactV2` binds the exact model-spec/input-contract digests, DEVELOPMENT dataset, runtime contract and opaque artifact payload digest. No artifact grants runtime or capital authority.
5. The org-scoped selected-package binding is append-only and content-addressed. It binds an exact scientific-admission receipt and exact package content digest to exact input-contract/model-spec/model-artifact digests.
6. Missing binding, legacy package without binding, digest mismatch, cross-org replay, stale substitution or natural-identity conflict returns `NOT_ADMITTED`/fails closed.
7. Existing Forecast/package/scientific identity algorithms are unchanged. This work is additive and does not touch models, arena, ensembles, scoring, holdout, Decision, Risk, production/live or capital semantics.

## Admitted surfaces

- `lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2.ts`
- `lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1.ts`
- `lib/trader/intelligence/forecast-v2/index.ts`
- `db/migrations_postgres/0169_trader_forecast_contract_binding_v1.sql`
- `db/migrations_postgres/0170_trader_forecast_contract_binding_v1_rls.sql`
- `db/migrations_postgres/meta/_journal.json`
- `tests/unit/forecast-contract-foundation-v2.test.ts`
- `tests/integration/postgres-forecast-contract-binding-v1.test.ts`
- PostgreSQL workflow test inclusion, if the new test is not already selected
- this plan and its frozen manifest

## Acceptance

- Canonical construction/reconstruction and declared-versus-undeclared mutation tests pass.
- Applicability prerequisite is exact and demonstrably outside predictor identity.
- Durable roundtrip, independent-writer idempotency/conflict, tenant isolation, replay/stale and append-only mutation tests pass on PostgreSQL.
- Legacy/no-binding package is deterministically `NOT_ADMITTED`.
- Focused, typecheck/build, one fresh-SQLite full suite, exact-head review, authoritative CI/PostgreSQL and DEE-653 pass before squash merge.
