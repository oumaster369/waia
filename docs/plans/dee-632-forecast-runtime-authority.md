---
integrationIssue: DEE-632
branch: dee-632-forecast-runtime-authority
riskTier: T3
authoritativeBase: 4acb6c61a1479fc57f4ffd1cac53d03cf2f77118
state: frozen-delivered
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
