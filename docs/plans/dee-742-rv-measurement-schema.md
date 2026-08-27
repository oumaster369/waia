---
integrationIssue: DEE-742
integrationTitle: "RV v2 measurement and schema identity"
parentIssue: DEE-624
branch: dee-742-rv-measurement-schema
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - focused-known-answer-and-negative-tests
  - typecheck
  - production-build
  - one-full-fresh-migrated-sqlite-suite
  - canonical-and-pr-governance
  - independent-exact-head-review
  - applicable-postgres-and-dee-653
approvalGates:
  - human-ratified-dee-624m-split
  - exact-head-independent-review
  - dee-653-exact-head-admission
includedIssues: [DEE-744, DEE-743]
state:
  status: locally-validated-awaiting-pr
  currentWorkPackage: null
  completedWorkPackages: [DEE-744, DEE-743]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: d0b1e822130e5df58b3c21527759c91e47454bc3
  lastValidationAt: "2026-08-27T12:00:00+03:00"
  blockedReason: null
  nextAction: "Complete the running full fresh-SQLite suite, publish one governed PR, and require CI/DEE-653 before squash merge."
provenance:
  createdFrom: human-ratified-dee-624m-split
  sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
  authoritativeBase: 36929bba3f46ec79002ef45f2a04dce8e86593c4
  admissionAudit: "Fresh origin/main and producer/consumer/replay/persistence/test/inventory/dependency/ownership surfaces inspected before writes."
---

# DEE-742 — RV v2 measurement and schema identity

## Frozen API and invariants

1. `FeatureVectorRvV2` requires `priceDispersion20`, `realizedVar20m_1m`, and `realizedVol20m_1m`; `FeatureSnapshotRvV2` carries that exact vector.
2. `computeFeatureSnapshot` returns the refined v2 snapshot and the live/backtest parity contract compares every canonical RV v2 field.
3. `FEATURE_ENGINE_RV_VERSION`, RV equations, PIT window, closed-contiguous-1m gap behavior, decimal formatting, and rounding remain byte-for-byte unchanged.
4. Legacy `realizedVol20` remains an exact compatibility alias to `priceDispersion20` in this slice.
5. Strategy, Event, MI, Regime, MSV and `expectedEdge` consumers are inventoried but not reinterpreted; their final disposition remains in DEE-624 after DEE-634.
6. Holdout, Decision, Risk, execution, production/live and capital semantics are excluded.

## Work packages

- DEE-744: required schema, producer typing, exact alias and parity fields.
- DEE-743: known-answer, UNAVAILABLE, PIT-prefix, mutation and consumer-inventory proof.

## Acceptance

- Focused positive/negative tests demonstrate canonical required fields, exact aliasing and parity mutation detection.
- Repository inventory truthfully quarantines every residual legacy consumer.
- Typecheck/build, one fresh migrated SQLite suite, exact-head independent review, applicable CI/PostgreSQL and DEE-653 pass before squash merge.
