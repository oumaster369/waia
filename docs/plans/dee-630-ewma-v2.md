---
integrationIssue: DEE-630
integrationTitle: "Canonical EWMA return-squared baseline v2"
parentIssue: DEE-601
branch: dee-630-ewma-correction
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation:
  - focused-known-answer-and-negative-tests
  - typecheck
  - production-build
  - one-full-fresh-migrated-sqlite-suite
  - canonical-and-pr-governance
  - independent-exact-head-review
  - authoritative-postgres-and-dee-653
approvalGates:
  - human-ratified-dee-630-scope
  - t3-scope-preauthorized
  - exact-head-independent-review
  - dee-653-exact-head-admission
includedIssues: [DEE-738, DEE-737, DEE-736]
state:
  status: in-review
  currentWorkPackage: null
  completedWorkPackages: [DEE-738, DEE-737, DEE-736]
  remainingWorkPackages: []
  prNumber: 499
  prUrl: https://github.com/oumaster369/waia/pull/499
  lastValidatedGitSha: 2b586373e0f47887533f4777abadcc4997b48443
  lastValidationAt: "2026-08-26"
  blockedReason: null
  nextAction: "Repair canonical-plan metadata, refresh exact-head review, then require authoritative CI/PostgreSQL and DEE-653 before squash merge."
provenance:
  createdFrom: human-ratified-dee-630-scope
  sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
  authoritativeBase: 95e421b0026bafdcd4bf28f2fa23753d0fd2157f
  admissionAudit: "Fresh origin/main, Linear dependency/duplicate/ownership and producer/consumer/replay/persistence/test surfaces were admitted before writes."
  acceleratedQualityProtocol: "API and invariants froze before implementation; file-disjoint work packages were serialized under one integrator and one PR."
---

# DEE-630 — Canonical EWMA baseline v2

## Frozen API and invariants

1. EWMA variance starts from the DEVELOPMENT sample variance and applies `0.94 × variance + 0.06 × r²` to raw 1m returns; adjacent returns are never differenced.
2. The latest window contains exactly 2000 observations at strictly increasing 60,000 ms timestamps. Missing timestamps, gaps, duplicates, reverse order, nulls and non-finite returns make EWMA unavailable.
3. Forecast volatility is `sqrt(variance) × sqrt(h)` for the existing 30m or 60m horizon.
4. The corrected baseline identity is `ewma-lambda094/v2`; v1 is not in the mandatory family. Research-harness and scientific-admission receipt identities advance to v2 so defective evidence cannot collide with corrected evidence.
5. Lambda, warm-up length, horizons, target grid, scoring, bootstrap, Holm and blind-holdout policy do not change. Decision, Risk, production/live and capital surfaces are excluded.

## Work packages

- DEE-738: corrected computation and fail-closed input contract.
- DEE-737: baseline/trial/receipt identity invalidation.
- DEE-736: known-answer, negative, scaling, replay and integration evidence.

## Validation

Focused and negative tests run continuously. The frozen exact head requires lint, typecheck, build, one fresh SQLite full suite, exact-head independent review with zero P1/P2, authoritative CI/PostgreSQL and DEE-653 before squash merge.

## Acceptance

- Canonical EWMA uses raw return squared with DEVELOPMENT sample-variance initialization and exact contiguous 2000×1m evidence.
- Missing, null, non-finite, unsafe, gapped, duplicate or out-of-order evidence fails closed.
- Corrected v2 identities prevent reuse of defective v1 trial, bootstrap and admission evidence.
- Focused/negative, compile/build, canonical/governance, fresh-SQLite, exact-head review, authoritative PostgreSQL/CI and DEE-653 gates pass before squash merge.
