---
integrationIssue: DEE-632
integrationTitle: "Forecast V2 Sole Predictive Runtime Authority"
parentIssue: DEE-601
branch: dee-632-forecast-runtime-authority
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation: [focused-negative-tests, typecheck, production-build, one-full-fresh-migrated-sqlite-suite, independent-exact-head-review, authoritative-postgres-and-dee-653]
approvalGates: [ratified-dee-627-canon, exact-head-independent-review, dee-653-exact-head-admission]
includedIssues: [DEE-632, DEE-756, DEE-757]
state:
  status: frozen-delivered
  currentWorkPackage: null
  completedWorkPackages: [DEE-756, DEE-757]
  remainingWorkPackages: []
  prNumber: 508
  prUrl: "https://github.com/oumaster369/waia/pull/508"
  lastValidatedGitSha: 83714813348c509f407ea0d7c3602398a6614b55
  lastValidationAt: "2026-08-27T20:03:00Z"
  blockedReason: null
  nextAction: "Close authoritative CI, PostgreSQL and DEE-653 gates before squash merge."
provenance:
  createdFrom: ratified-dee-632-build
  authoritativeBase: 4acb6c61a1479fc57f4ffd1cac53d03cf2f77118
  admissionAudit: "Fresh origin/main, Linear duplicate/ownership/dependency audit, and complete producer/consumer/replay/persistence/test/inventory/plan audit passed before implementation writes."
---

# DEE-632 — Forecast V2 sole predictive runtime authority

## Frozen boundary

`PredictiveAdmissionReceiptV1 + ForecastContractBindingV1 + explicit PredictivePackageV1 + exact PIT predictor → ForecastRuntimeAuthorityV2 | NON_ACTIONABLE`.

The authority owns only the probability/distribution of future outcomes. It cannot emit or consume BUY/SELL, StrategySignal confidence/edge, EV, size, trading permission, Risk, execution, holdout, production/live or capital semantics.

## API and invariants

`issueForecastRuntimeV2(ForecastRuntimeInputV2)` returns a discriminated `ForecastRuntimeOutcomeV2`. An authorized result carries the existing deterministic `ForecastIssuanceV1` plus a content-addressed authority manifest. Every invalid, absent, research-only, stale, non-actionable or mismatched input returns a content-addressed typed `ForecastRuntimeNonActionableV2`; no exception or legacy forecast fallback creates authority.

The implementation validates the Predictive Admission receipt semantically, cross-binds organization/package/input-contract/model-spec/model-artifact/scientific admission, requires canonical anchor↔epoch identity, binds only `anchorRealizedVol20m_1m`, checks model transform/development/runtime and both target identities, then delegates unchanged mathematics to `issueForecastV1`. Both distribution semantic digests and both forecast content digests must replay exactly.

`ForecastModelArtifactV2.artifactPayloadDigestHex` is never inferred from `PredictivePackageV1`: no canonical codec currently proves that equality. The executable package is supplied explicitly and only provable identities are cross-bound.

## Runtime cutover

The canonical evaluation cycle exposes `forecastRuntimeOutcome`. Callers may pass the frozen Forecast runtime input constructed by their already-authoritative loading/admission boundary. Omission is explicitly NON_ACTIONABLE. Legacy `ForecastDecisionBundle` remains available only for compatibility and historical WP14/WP15 evidence; it is never substituted for missing Forecast V2 authority.

No Decision/Risk/execution/live caller is changed in this issue. Downstream capital convergence remains owned by DEE-634/DEE-639.

## Surfaces

- Producer: DEE-647 predictive admission, DEE-648A contract binding, exact executable PredictivePackageV1.
- Consumer: canonical `runEvaluationCycle()` result and deterministic historical/paper-equivalent harnesses.
- Replay: regeneration of Forecast generation, terminal/execution distribution and content seals.
- Persistence: existing Forecast V2 append-only persistence only; no migration.
- Inventory: all evaluation-cycle and legacy ForecastDecisionBundle consumers, with a forbidden-edge proof.
- Tests: authorized replay, every identity mismatch, missing/research-only admission, insufficient package pools, deterministic equivalence and legacy-bypass rejection.

## Acceptance

- Exact admitted receipt, contract, package, model, artifact, runtime, target, PIT and input identities are required and fail closed.
- Terminal and execution distributions/content seals replay deterministically; malformed, missing and research-only inputs remain typed NON_ACTIONABLE.
- The canonical evaluation cycle exposes the Forecast V2 runtime outcome without any legacy ForecastDecisionBundle fallback.
- Focused negative tests, typecheck/build, a fresh migrated SQLite validation, exact-head review, authoritative CI/PostgreSQL and DEE-653 pass before squash merge.
