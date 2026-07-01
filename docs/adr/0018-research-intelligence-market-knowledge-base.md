# ADR-0018 — Research Intelligence Layer & Market Knowledge Base

Status: Accepted  
Date: 2026-07-01  
Supersedes (partial): Master Spec v2 §10, MVP-Scope v2 OUT, MI-Architecture §16/§18, Ratification §4 — **for the live-readiness path only**

## Context

AI-TRADER MVP delivered a production-grade execution/paper pipeline but deferred automated historical validation to post-MVP. ADR-0010 requires edge evidence net of modeled costs across more than one regime before live promotion. The repository cannot produce that evidence today: no historical OHLCV store, no backtest engine, no walk-forward/blind validation, and existing promotion artifacts are synthetic mock evidence.

The Architect paused HC-3.5/HC-4/L4 until a Research Intelligence (RI) layer exists. This ADR ratifies that layer and the Market Knowledge Base (MKB) architecture built on the existing MI stack.

## Decision

1. **Research Intelligence layer (RI)** is required before responsible Org-0 live promotion. It comprises:
   - `trader_market_bars` — canonical append-only OHLCV history (Postgres, ADR-0017).
   - `trader_market_facts` — extensible Layer-1 facts (`fact_kind` taxonomy).
   - `research_dataset` — sealed train/validation/blind splits with SHA-256 digests.
   - `HistoricalBarSource` — chronological replay over stored bars, reusing `runPaperCycleOnce` for live/backtest parity.
   - Backtest engine — `trader_backtest_runs` + `trader_backtest_results` with versioned cost/slippage model and `BacktestEvaluationExportDocument`.
   - Walk-forward + single-shot blind holdout with anti-overfit locks and MI trial pre-registration.
   - Strategy candidate registry linking hypotheses to validation runs.

2. **Market Knowledge Base (4 layers)** maps onto existing `trader_mi_*` tables plus new read-models:
   - Layer 1 Facts — `trader_market_bars`, `trader_market_facts`.
   - Layer 2 Observed Events — `trader_mi_observation`, `trader_market_events`.
   - Layer 3 Causal Hypotheses — `trader_mi_hypothesis`, `trader_knowledge_edges` (confidence-weighted; correlation labeled, never asserted as certainty).
   - Layer 4 Verified Knowledge — read-model over repeatedly confirmed edges.

3. **Market Memory** — prediction → outcome → learning loop mirroring `twin_prediction_verifications`; persisted reasoning audit trail.

4. **Storage architecture:**
   - Postgres only for new RI modules (ADR-0017).
   - Optional pgvector for semantic recall (reuse twin embedding pattern); not required for MVP RI path.
   - **No graph database** — relational + pgvector hybrid (ADR-0006 minimalism).
   - R2 for cold bulk artifacts only; heavy compute on execution host, never Worker fast path.

5. **World State Engine** (Parts 18–22 of RI program) is long-term North Star guidance only — not in this ADR's implementation scope.

## Consequences

+ Unblocks responsible live-readiness path with real multi-regime evidence.
+ Reuses MI knowledge stack; avoids green-field KB.
+ Controlled supersession of post-MVP deferral via governance, not silent code change.
− Significant new engineering (Batches B–H of RI program).
− SQLite parity unsupported for new RI modules (ADR-0017).

## Links

- [ADR-0010 Strategy Validation Gate](0010-strategy-validation-gate.md)
- [ADR-0017 Postgres-only trader MVP](0017-postgres-only-trader-mvp.md)
- [AI-TRADER Research Intelligence Program](../ai-trader/AI-TRADER-RESEARCH-INTELLIGENCE-PROGRAM.md)
- [AI-TRADER Market Intelligence Architecture](../ai-trader/AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md)
