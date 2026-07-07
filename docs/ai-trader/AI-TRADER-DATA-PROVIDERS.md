# AI-TRADER Data Providers (PR2.5 + PR2.6 binding spec)

Status: **PR2.5 + PR2.6 implementation binding** · Date: 2026-07-07

This document is the binding companion for Market Intelligence provider integration delivered in **PR2.5 — Market Intelligence Integration**. It defines registry entries, gateway routing, degradation policy, and architectural boundaries. Implementation lives under `lib/trader/market-data/` and `lib/trader/connectors/`.

> **Authority:** Parent intelligence evolution roadmap (`.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md`) wins on ambiguity. Providers produce **evidence only** — never trading decisions.

---

## Binding pipeline (no bypass)

All external market data MUST flow through:

```text
Provider Registry
  → Market Data Gateway (`MarketDataGateway`)
  → Normalization (`normalize-observation.ts`)
  → Validation (`validate-observation.ts`)
  → Freshness / Reliability (`provider-health.ts`)
  → Context Fusion (`context-fusion-v0.ts`)
  → Market Understanding Bridge (`market-understanding-bridge-v0.ts`) — PR2.6
  → MSV hook (`buildMsvEnvelope`)
  → Chief Decision Engine hook (`cde-v0.ts`)
  → Risk Engine / Strategy evaluation
```

Direct provider client imports from strategy, research, CDE, or paper modules are **forbidden**. Research paths consume fixture bars or gateway outputs only.

---

## Provider registry

Registry module: `lib/trader/market-data/provider-registry.ts`  
Distinct from execution connector registry (`lib/trader/connectors/registry.ts`).

| ID | Provider | Required | Observation kinds | Role |
|----|----------|----------|-------------------|------|
| `htx_spot` | HTX Spot | **Yes** | `ohlcv_bar`, `quote_l1`, `order_book_snapshot` | Primary execution venue + market truth |
| `binance_public` | Binance Public | No | `cross_exchange_confirmation`, `quote_l1` | Secondary price confirmation |
| `bybit_public` | Bybit Public | No | `cross_exchange_confirmation`, `quote_l1` | Tertiary price confirmation |
| `alternative_me` | Alternative.me | No | `fear_greed_index` | Crowd psychology evidence |
| `coingecko_global` | CoinGecko | No | `global_market_stats` | Global crypto backdrop |

---

## Gateway entry point

**Class:** `MarketDataGateway` (`lib/trader/market-data/market-data-gateway.ts`)

**Poll API:** `pollEvaluationBundle()` → `{ snapshot, fusedContext, mtfBarsByInterval }`

**Consumers:**
- `HtxBarPollSource` — paper cycles and integration tests
- `market-brain/htx-ingestion.ts` — scheduled ingest
- `market-brain/market-brain-pipeline.ts` — routes through `runEvaluationCycle()` (understanding bridge + CDE)
- Evaluation cycle via optional `fusedContext` on `EvaluationCycleInput`

**Configuration:**
- `disableOptionalProviders: true` — HTX-only mode for deterministic tests
- `fetchImpl` — injectable fetch for fixtures/mocks
- `coingeckoApiKey` — optional; degrades gracefully when absent

---

## MTF cognitive layers (PR2.5)

| Interval | Cognitive role | Source |
|----------|----------------|--------|
| `1d` | Global placement | HTX klines |
| `4h` | Regime dominance | HTX klines |
| `1h` | Regime evolution | HTX klines |
| `15m` | Opportunity emergence | HTX klines |
| `1m` | Execution precision | HTX klines + L1 quote |

All intervals are fetched from HTX via `mtf/mtf-bar-aggregator.ts` and normalized as `ohlcv_bar` observations with provenance.

---

## Normalized observation contract

Schema: `waia.trader.observation.v1` (`lib/trader/market-data/observation-types.ts`)

Every observation exposes:
- `kind`, `sessionPhase`, `provenance`, `health`, `freshnessMs`, `latencyMs`, `confidence`, `payload`

Fused output schema: `waia.trader.fused_context.v1` (`FusedMarketContext`)

---

## Degradation policy

| Health | Confidence impact | CDE permission effect |
|--------|-------------------|----------------------|
| `HEALTHY` | Full confidence | `ALLOW_TRADING` |
| `DEGRADED` | Reduced confidence | `ALLOW_REDUCED_RISK` (risk multiplier 0.5) |
| `STALE` | Low confidence | `PAPER_ONLY` (risk multiplier 0.75) |
| `UNAVAILABLE` | Zero confidence | `PAPER_ONLY` (risk multiplier 0.75) |

**Failure policy:** degrade confidence and trading permission — **never crash campaign execution**. Optional provider failures append `degradationReasons[]` on `FusedMarketContext`.

HTX primary bars are required; evaluation aborts only when HTX OHLCV is unavailable after retry.

---

## Asian Session Range Corridor (research seed)

Module: `lib/trader/market-data/session/asian-range-corridor.ts`

- `SessionPhase` classification: `ASIA`, `EUROPE`, `US`, `OVERLAP`, `UNKNOWN`
- `AsianRangeCorridorMetadata.isResearchSeedOnly` is **always `true`** in PR2.5
- Metadata only — no automatic trades, no strategy signals

---

## Data-to-decision boundary

External data may affect **only**:
- confidence
- regime / context metadata
- trading permission
- risk multiplier
- position sizing constraints (downstream)

External data must **never** generate buy/sell signals directly.

---

## PR mapping

| Capability | PR2.5 | PR2.6 | PR3 | PR4 |
|------------|-------|-------|-----|-----|
| Registry + Gateway + adapters | Implement | Harden | Consume | Consume |
| MTF bars + fusion hooks | Implement | Backdrop classifier + replay resampler | Deepen features | Consume |
| Cross-venue triangulation | Winner-take-all | Both venues merged | — | — |
| Market Understanding Bridge | — | Implement | Consume | Consume |
| Feature Engine v1 (ATR/VWAP) | Contracts only | — | Implement | — |
| Market Context layer | — | — | Implement | — |
| CDE regime upgrades | Hook only | Understanding-informed permission | Implement | — |
| Market Memory / Research Questions | Hooks only | ResearchSignals export | — | Implement |

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `COINGECKO_API_KEY` | No | Optional CoinGecko rate-limit relief; degrades without key |

HTX, Binance, Bybit, and Alternative.me public endpoints require no authentication in PR2.5.

---

## Test fixtures

Deterministic fixtures under `tests/fixtures/trader/`:
- `htx-kline-btcusdt-1m.json` (existing golden)
- `binance-btcusdt-ticker.json`
- `bybit-btcusdt-ticker.json`
- `alternative-me-fear-greed.json`
- `coingecko-global.json`

Unit tests: `tests/unit/trader-market-data-pr25.test.ts`, `tests/unit/trader-provider-adapters.test.ts`

Integration tests use `tests/helpers/htx-gateway-mock-fetch.ts` with `disableOptionalProviders: true`.

---

## PR2.6 — Pre-M9 Market Understanding Bridge

PR2.6 transforms `FusedMarketContext` into deterministic `MarketUnderstandingSnapshot` before CDE permission. Providers still produce evidence only.

### Observation lifecycle (doctrine)

```text
Observed   → Provider answer ingested (PR2.5 gateway)
Validated  → Schema + quality gates pass (PR2.5)
Accepted   → Health/freshness above rejection threshold (PR2.5)
Fused      → Merged into FusedMarketContext (PR2.5)
Interpreted → MarketUnderstandingSnapshot produced (PR2.6)
Remembered → Archived in MKB / Market Memory (PR4 — not PR2.6)
```

### Architectural invariants (binding)

1. Provider ≠ Intelligence — providers produce evidence only.
2. Observation ≠ Knowledge — normalized observations are not MKB edges until PR4.
3. Knowledge ≠ Decision — understanding informs permission; never commands trades.
4. Decision ≠ Execution — CDE posture ≠ order submission.
5. Missing evidence must never become bullish evidence.
6. Cash/no-trade is a successful outcome when edge is insufficient.
7. Understanding remains deterministic — identical inputs → identical snapshot.
8. Replay remains byte-reproducible — no live optional-provider fetch in research backtest.
9. No provider bypass on governed paths.
10. All provider influence is advisory (confidence, permission, risk multiplier only).

### Core modules

| Module | Purpose |
|--------|---------|
| `market-understanding-bridge-v0.ts` | 11 canonical questions → snapshot |
| `cross-venue-triangulation.ts` | Binance + Bybit agreement (not winner-take-all) |
| `mtf-backdrop-classifier.ts` | Per-interval direction + alignment |
| `replay-mtf-resampler.ts` | Deterministic MTF from 1m replay |
| `replay-fused-context-builder.ts` | Replay `FusedMarketContext` for M9/research |
| `m9-market-understanding-export.ts` | `m9-market-understanding-sample.json` |

### Replay path (M9)

Research backtests MUST NOT call live Binance/Bybit. Use:

1. **Tier 1:** Resample MTF from historical 1m bars (`replay-fused-context-builder.ts`)
2. **Tier 2:** Optional fixture sidecar (`tests/fixtures/trader/m9-provider-sidecar.json`)

**M9 tier-2 operator workflow:**

```bash
# Default: vaultDir/m9-provider-sidecar.json when present
pnpm tsx scripts/trader/m9-v2-research-campaign.ts \
  --vault-dir=<vault> \
  [--provider-sidecar-path=<path>] \
  ...
```

The campaign loads the sidecar via `loadM9ProviderSidecar()` and passes `pipelineBacktest.providerSidecar` through the research orchestrator → `buildIsolatedBacktestInput` → `runResearchValidationBacktest`. Cross-venue, crowd, and global context from the sidecar appear in replay fused context and in `m9-market-understanding-sample.json` export artifacts.

### Future provider contract (doc template — PR3/PR4 runtime)

Every future provider MUST declare:

| Field | Meaning |
|-------|---------|
| Market questions answered | Canonical question IDs from intelligence roadmap |
| Freshness expectation | Max acceptable staleness before degradation |
| Reliability tier | Primary / secondary / fallback |
| Failure semantics | degrade / unavailable / retry — never crash |
| Confidence contribution | Bounded, monotonic influence on upstream confidence |

### PR2.6 test fixtures

- `m9-provider-sidecar.json` — timestamp-keyed optional observations for replay
- `market-understanding-aligned-trend.json` — golden aligned-trend understanding snapshot
- `market-understanding-cross-venue-conflict.json` — golden cross-venue conflict snapshot
- `market-understanding-gaps-conflict.json` — golden knowledge-gap conflict snapshot
- Unit tests: `trader-market-understanding-bridge.test.ts`, `trader-market-understanding-golden.test.ts`, `trader-cross-venue-triangulation.test.ts`, `trader-replay-fused-context.test.ts`, `trader-market-question-evaluation.test.ts`, `trader-m9-market-understanding-export.test.ts`
- Integration: `tests/integration/trader-htx-bar-poll-cycle.test.ts` asserts `evaluation.understanding` and all 11 canonical questions on live poll cycles

---

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

Grep guard: research modules must not import `connectors/binance`, `connectors/bybit`, `connectors/alternative-me`, `connectors/coingecko`, or `market-data-gateway` directly (`tests/unit/trader-research-backtest-isolation.test.ts`).
