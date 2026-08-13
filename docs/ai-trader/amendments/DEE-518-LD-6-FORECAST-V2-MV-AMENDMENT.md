# DEE-518 — LD-6 Forecast Doctrine Amendment (§4-MV + §4-MV.2)

> **Status:** Ratified amendment (Gate-D + DEE-518 WP-CANON)  
> **Parent:** [AI-TRADER Forecast Doctrine (LD-6)](../AI-TRADER-FORECAST-DOCTRINE.md)  
> **Authority:** DEE-516 Human ratification (2026-08-09); DEE-518 Human plan approval (2026-08-10)  
> **Implementation plan:** [`docs/plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md`](../../plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md) §2

## §4-MV — Multivariate predictive package (Terminal + Execution Opportunity)

LD-6 is amended for the first-program **Forecast V2 compact seal**:

1. **Same-package coherence.** Terminal Return (`R_h` marginal) and Execution Opportunity (13-D vector) MUST be issued from the **same** predictive package artifact at the same anchor `(symbol, t, h)`. Terminal is a deterministic projection of the package onto `R_h`; not a separate fitted distribution.

2. **Epistemic replicas (K).** `K` denotes DEVELOPMENT `stationary-bootstrap/v1` refits — epistemic model uncertainty. Fixed `K_config` at issuance; no `K_eff`. Fail-closed when state pools are insufficient.

3. **Aleatoric draws (M).** `M` denotes Monte Carlo draws from replica `k`'s predictive distribution. `S = K·M` ephemeral samples for Decision/scoring; **never** persisted as relational rows.

4. **Compact seal.** Per-forecast evidence is a compact seal with `distribution_semantic_digest` (`dist-sem-v1`), not per-sample rows. Replica artifacts ≤ 65536 bytes each (`bytea`).

5. **Identity DAG.** Non-circular digest layers: `replica-root-family/v1` → `pkg-gen-id/v2` → `fcst-gen-id/v1` → `forecast-sampling-family/v1` → `distribution_semantic_digest`. See plan §2.10–§2.11.

## §4-MV.2 — State-conditional empirical joint

The first-program EXECUTOR_READY model is `rv-state-conditional-empirical-joint/v1`:

- Feature: `realizedVol20m_1m` from `feature-engine/rv/v2` (§2.2).
- State assignment: `rv-state-tertile/v1` on bootstrap multiset edges.
- Pools preserve bootstrap multiplicity; canonical order by `resample_position_ordinal`.
- Heuristic hypothesis confidence is **not** a Forecast V2 probability input (plan §1.21).

## Non-goals (unchanged LD-6 boundaries)

- Forecast does not decide, size, or enforce Risk.
- Forecast does not access BLIND_HOLDOUT during DEE-518 implementation.
- No per-sample relational persistence surface.
