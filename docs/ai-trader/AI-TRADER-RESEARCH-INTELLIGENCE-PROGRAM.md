# AI-TRADER Research Intelligence Program

Canonical execution program for Milestone **M11 — AI-TRADER Research Intelligence & Market Knowledge**.

**Governance:** [ADR-0018](../adr/0018-research-intelligence-market-knowledge-base.md) · [ADR-0019](../adr/0019-ai-operator-intelligence-authority.md) · [ADR-0010 amendment](../adr/0010-strategy-validation-gate.md)

**Status:** Active. HC-3.5 / HC-4 / L4 live gates remain **paused** until real multi-regime evidence exists (Batch H / RI-P7).

## Purpose

Evolve AI-TRADER from an execution/paper pipeline into a market-intelligence and strategy-validation system that:

1. Stores real historical market data.
2. Backtests and walk-forward validates strategies with cost realism.
3. Enforces single-shot blind holdout with anti-overfit locks.
4. Accumulates knowledge via the Market Knowledge Base (MKB) over the existing MI stack.
5. Operates research via a recommend-only AI Operator (never promotes or trades).

## Implementation packages

| Package | Batch | Goal |
|---------|-------|------|
| RI-P0 | A | ADRs + this program doc |
| RI-P1 | B | OHLCV store, market facts, dataset sealing, HTX backfill |
| RI-P2 | C | HistoricalBarSource, backtest engine, cost model, evidence doc |
| RI-P3 | D | Candidate registry, walk-forward, blind holdout |
| RI-P4 | E | MKB + Market Memory read-models |
| RI-P5 | F | AI Operator v0 (recommend-only) |
| RI-P6 | G | ADR-0010 gate integration + research dashboard |
| RI-P7 | H | Trend strategy + multi-regime evidence (HC-3.5 human ceremony) |
| RI-P8 | I | On-chain intelligence — **DEFERRED** |

Critical path: `P0 → P1 → P2 → P3 → P6 → P7`. P4 branches after P1; P5 needs P2+P3+P4.

## Strategy lifecycle (summary)

`IDEA → HYPOTHESIS → DATASET_READY → BACKTEST → WALK_FORWARD → BLIND_VALIDATION → FORWARD_PAPER → ADR_0010_READY → LIVE_LIMITED → ACTIVE → RETIRED`

See Master Spec §9; ADR-0010 amendment defines the historical evidence class before `LIVE_LIMITED`.

## Historical validation methodology

- Train / validation / blind splits sealed with SHA-256 digests.
- Parameter freeze before blind; blind usable once per candidate.
- Multi-regime requirement: ≥1 non-trending + ≥1 down regime.
- Cost/slippage versioned; metrics net of modeled costs.
- Thresholds operator-set; absence of evidence = failure.

## Knowledge architecture

Four layers mapped to storage:

1. **Facts** — `trader_market_bars`, `trader_market_facts`
2. **Events** — `trader_mi_observation`, `trader_market_events`
3. **Hypotheses** — `trader_mi_hypothesis`, `trader_knowledge_edges`
4. **Verified knowledge** — read-model over confirmed edges

Relational + optional pgvector. **No graph DB.**

## AI Operator

Recommend-only orchestration per ADR-0019. Uses `lib/ai-gateway` + DEE-80 prompt envelopes. Full action audit.

## North Star (non-executable)

Parts 18–22 of the master plan (World State Engine, Knowledge Evolution, long-term vision) guide future architecture only — not MVP RI scope.

## Validation commands

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
# Migration-bearing PRs:
WAIA_PG_INTEGRATION=1 pnpm test --run
```

## Canon reconciliation

| Source | Relationship |
|--------|--------------|
| Master Spec v2 §10 | Superseded for live path via ADR-0018 |
| MVP-Scope v2 OUT | Research engine now in-scope for live readiness |
| ADR-0017 | All new RI modules Postgres-only |
| ADR-0006/0007 | Single repo; targeted RLS |
| ADR-0011 | Single operator; human ceremonies for promotion |
