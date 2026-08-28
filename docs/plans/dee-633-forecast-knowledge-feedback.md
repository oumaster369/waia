---
integrationIssue: DEE-633
integrationTitle: "Forecast V2 Outcome, Calibration and Knowledge Feedback"
parentIssue: DEE-601
branch: dee-633-forecast-knowledge-feedback
riskTier: T3
prPolicy: one-integration-pr
includedIssues: [DEE-633, DEE-759, DEE-758]
authoritativeBase: bb5f5d3645cd907a416bc7eee3714c5c3f59d57c
state: admitted
---

# DEE-633 — Forecast V2 outcome → calibration → knowledge feedback

## Frozen public boundary

`ForecastRuntimeAuthorizedOutcomeV2 + objective PIT outcome evidence → ForecastCalibrationObservationV2 | typed NON_SCORING → deterministic KnowledgeConfidenceUpdateRecord → future-cycle Knowledge read state`.

The scoring probability comes only from the exact Forecast V2 terminal distribution issued by `ForecastRuntimeAuthorityV2`. Legacy `forecast_confidence_json.confidence_value`, Decision/Research confidence and Market Memory heuristic mutation are never probability or update authority on this path.

## Exact invariants

- organization, predictive package, terminal target, symbol, horizon, PIT anchor and Forecast issuance identities cross-bind exactly and fail closed;
- outcome resolution is append-only, objective, single-verify and idempotent;
- Brier/log-loss inputs and encoding are versioned, deterministic and known-answer tested;
- only terminally qualified resolved evidence may emit a bounded update; inconclusive/non-scoring evidence emits no positive authority;
- updates become visible to future cycles only and cannot affect the closing run/cycle;
- knowledge updates carry `capital/strategy/tradeEligibility/guardian = NONE`; model or policy promotion remains Human-gated research lifecycle;
- replay/checkpoint regeneration yields identical outcome, observation, snapshot and update content digests.

## Ratified scoring and feedback contract

The versioned seven-class proper-scoring convention is frozen as follows: normalized multiclass Brier is `(1/2) * sum_k((p_k - o_k)^2)` and therefore lies in `[0,1]`; log loss is `-ln(max(p_observed, 1e-15))`. Computation retains JavaScript double full precision. Persisted decimals use the existing canonical decimal-string convention and never feed Decision or capital authority. Bucket definitions and observed-bucket mapping are reused exactly from the sealed Forecast V2 target grid and are never inferred or altered.

Knowledge feedback is evidence-only: the emitted bounded `KnowledgeConfidenceUpdateRecord` has an exact zero delta. The record binds a caller-supplied issuance-time `knowledgeEdgeId` and sealed Knowledge content digest; neither value may be inferred from symbol, regime or outcome. All downstream authority fields remain `NONE`.

## Persistence and rollback

Extend the existing append-only Forecast V2 outcome and calibration tables with the minimal immutable semantic payload required for exact replay: PIT measurement identity, objective bucket/value payload, probability vector, proper scores, Forecast authority/package/target/distribution identities, and issuance-time Knowledge edge/content digests. Reuse the existing knowledge-confidence-update repository. The migration adds no Decision/Risk/execution/capital fields. Rollback is one squash revert and does not rewrite durable evidence.

## Validation

Focused/negative known-answer, cross-bind, duplicate closure, same-cycle rejection, future-cycle visibility, decay and replay suites run continuously. After semantic completion: one literal fresh migrated SQLite full suite, exact-head independent review P1=0/P2=0, existing WP21/Forecast PostgreSQL roundtrip, authoritative CI and DEE-653 before squash merge.
