# AI-TRADER Data Providers (PR2.5 + PR2.6 + Data Provider Readiness binding spec)

Status: **PR2.5 + PR2.6 + Data Provider Readiness (DEE-392)** · Date: 2026-07-07

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

| Variable | Required | Purpose | Consumed in |
|----------|----------|---------|-------------|
| `HTX_REST_HOST` | No | HTX REST host override (default `https://api.huobi.pro`) | `market-brain/build-worker-deps.ts`, `paper/build-worker-deps.ts`, `htx-bar-poll-source.ts`, gateway |
| `COINGECKO_API_KEY` | No | Optional CoinGecko rate-limit relief; degrades without key | `market-data-gateway.ts`, bridged in `worker-cron-env.ts` |
| `MARKET_BRAIN_ENABLED` | When cron ingest | Enables MSV/CDE ingestion cycle | `market-brain/build-worker-deps.ts` |
| `MARKET_BRAIN_ORGANIZATION_ID` | When enabled | Target org UUID | Same |
| `PAPER_LOOP_*` | When paper cron | Paper loop worker (uses gateway via `HtxBarPollSource`) | `paper/build-worker-deps.ts` |
| `AI_TRADER_MASTER_KEY_DEV` | Local/test | Master key for HTX credential encryption | `dev-master-key-provider.ts` |
| `AI_TRADER_MASTER_KEY` | Production | Secrets Store binding for credential decrypt | `secrets-store-master-key-provider.ts` |
| `WAIA_HTX_LIVE_SMOKE` | Test-only | Opt-in live HTX integration smoke | `trader-htx-candles-live-smoke.test.ts` |

HTX public market REST, Binance, Bybit, and Alternative.me require **no authentication** in PR2.5.

**HTX trade credentials (API key, secret, passphrase) are NEVER environment variables.** They are entered only through the Trader Workspace UI and encrypted at rest via the existing credential architecture. See [`docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md).

Payment watcher TronGrid vars (`TRONGRID_API_KEY`, `TRON_RPC_*`, `WATCHER_*`) are settlement infrastructure — not MI gateway providers. See [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md).

**Deferred env vars:** No `FRED_API_KEY` or `INFURA_*` names exist in this repository until Full Market Data Source Integration grooming approves them.

---

## Canonical 20-source tier table

Parent roadmap Part V — deduplicated canonical sources. **Repeat M9 required vs deferred** column governs Gate A provider gates only.

| Tier | # | Source | Repeat M9 required vs deferred | Auth | Registry / adapter today |
|------|---|--------|-------------------------------|------|--------------------------|
| 0 | 1 | **HTX** | **Required** | Public REST; trade via UI | `htx_spot` — gateway + execution connector |
| 1 | 2 | **CoinGecko** | Required (fail-soft) | Optional `COINGECKO_API_KEY` | `coingecko_global` |
| 1 | 3 | **Binance Public** | Required (fail-soft) | No auth | `binance_public` |
| 1 | 4 | **Bybit Public** | Required (fail-soft) | No auth | `bybit_public` |
| 2 | 5 | **Alternative.me** | Required (fail-soft) | No auth | `alternative_me` |
| 3 | 6 | **FRED** | **Deferred** | Future API key TBD | Not implemented |
| 3 | 7 | **Federal Reserve** | **Deferred** | No auth (public site) | Not implemented |
| 3 | 8 | **CME FedWatch** | **Deferred** | Reference / terms-bound | Not implemented |
| 4 | 9 | **GDELT** | **Deferred** | No auth | Not implemented (PR4 news engine) |
| 4 | 10 | **CoinDesk RSS** | **Deferred** | No auth | Not implemented |
| 4 | 11 | **Cointelegraph RSS** | **Deferred** | No auth | Not implemented |
| 4 | 12 | **Decrypt RSS** | **Deferred** | No auth | Not implemented |
| 5 | 13 | **Binance Announcements** | **Deferred** | No auth | Not implemented |
| 5 | 14 | **HTX Announcements** | **Deferred** | No auth | Not implemented |
| 5 | 15 | **Bybit Announcements** | **Deferred** | No auth | Not implemented |
| 6 | 16 | **GitHub Public API** | **Deferred** | No token (rate limits) | Not implemented |
| 7 | 17 | **Infura / MetaMask RPC** | **Deferred** | Future API key TBD | Not implemented |
| 7 | 18 | **TronGrid (AI-TRADER intelligence)** | **Deferred** | Separate key from payment watcher | Not implemented |
| 7 | 19 | **mempool.space** | **Deferred** | No auth | Not implemented |
| 8 | 20 | **SEC EDGAR** | **Deferred** | No auth (policy-bound) | Not implemented |

**Repeat M9 required vs deferred summary:** Five registry providers are **required for Repeat M9** (HTX primary + four optional fail-soft confirmations). All Tier 3–8 sources are **deferred** to post-Gate-A / Full Market Data Source Integration / PR3–PR4 — none block Repeat M9 once the five-registry stack is validated end-to-end.

---

## Environment and secrets

| Provider | Required secret | Optional secret | Public / no-auth | Storage | Rotation |
|----------|----------------|-----------------|------------------|---------|----------|
| HTX trade | UI Read+Trade key+secret (+ passphrase if applicable) | — | Public klines/ticker | Trader UI → encrypted DB | Reconnect in Trader Workspace |
| HTX REST host | — | `HTX_REST_HOST` | Default host works | `.env.local` / Cloudflare var | Update env |
| CoinGecko | — | `COINGECKO_API_KEY` | Unauthenticated global endpoint | `.env.local` / `wrangler secret put` | Replace secret |
| Binance / Bybit / Alt.me | — | — | Public endpoints | — | N/A |
| Master key | `AI_TRADER_MASTER_KEY` (prod) / `AI_TRADER_MASTER_KEY_DEV` (local) | — | — | Secrets Store / `.env.local` | [`DEE-220-MASTER-KEY-RUNBOOK.md`](../ops/DEE-220-MASTER-KEY-RUNBOOK.md) |
| TronGrid watcher | `TRONGRID_API_KEY` | `TRON_RPC_SECONDARY_API_KEY` | Default RPC URL | Worker secret | BP-9A Step 6 |
| FRED / Infura | — (deferred) | Future TBD | — | Not in repo | Future phase |

**Security rules (binding):**

- Never commit `.env`, `.env.local`, `.dev.vars`, or API keys.
- `.env.example` and `.dev.vars.example` contain **placeholders only**.
- TronGrid payment watcher key must remain **separate** from future TronGrid AI-TRADER intelligence key.
- No HTX key with withdraw permissions.

---

## Provider health observability

Health is computed inline — there is no standalone provider probe service in Data Provider Readiness.

| Signal | Source module | Operator observability |
|--------|---------------|------------------------|
| **Health** | `provider-health.ts` → `NormalizedObservation.health` | `FusedMarketContext.aggregateHealth` |
| **Freshness** | `freshnessMs` vs 60s degraded / 120s stale | `degradationReasons[]` on fused context |
| **Latency** | Gateway `timed()` wrapper | `NormalizedObservation.latencyMs` |
| **Degradation** | Gateway catch blocks | e.g. `coingecko_unavailable:…`, `binance_unavailable:…` |
| **Fallback** | Optional fail-soft; HTX bars fail-closed | Market brain cycle may halt on HTX primary failure |
| **Confidence degradation** | `aggregateConfidence` | CDE risk multiplier in `cde-v0.ts` |
| **Permission degradation** | Health → CDE permission | `HEALTHY` → `ALLOW_TRADING`; `STALE`/`UNAVAILABLE` → `PAPER_ONLY` |

**Telemetry:** Market brain cycle emits counters such as `MARKET_BRAIN_CYCLE_OK`, `MARKET_BRAIN_INGESTION_HALT`, `MARKET_BRAIN_QUALITY_HALT` via `run-market-brain-cycle.ts`.

**Verification without Repeat M9:**

```bash
pnpm test --run tests/unit/trader-market-data-pr25.test.ts
pnpm test --run tests/unit/trader-provider-adapters.test.ts
pnpm test --run tests/integration/trader-htx-bar-poll-cycle.test.ts
```

Optional live smoke (operator opt-in): `WAIA_HTX_LIVE_SMOKE=1 pnpm test --run tests/integration/trader-htx-candles-live-smoke.test.ts`

---

## Gateway bypass inventory

**Governed intelligence path:** all optional market-data clients import only from `market-data-gateway.ts` (enforced by `trader-research-backtest-isolation.test.ts`).

**Intentional bypasses (documented — do not route through MI gateway):**

| Call site | Purpose | Allowed |
|-----------|---------|---------|
| `HtxExchangeConnector.streamMarketData()` | Execution connector surface | Yes — not intelligence |
| `scripts/trader/htx-kline-backfill.ts` | Ops DB backfill | Yes — ops tool |
| `replay-fused-context-builder.ts` | M9/research replay | Yes — no live HTTP |
| `fetchPrimaryBarsOnly()` in gateway | Unused export | Document only — remove in integration phase |

---

## Known implementation gaps

| Gap | Registry / docs | Implementation | Next phase |
|-----|-----------------|----------------|------------|
| **`order_book_snapshot`** | Declared on `htx_spot` kinds | **Not fetched** — no gateway path, no normalizer | Full Market Data Source Integration |
| Provider health probe service | Documented observability contract | Inline scoring only | Optional in integration phase |
| Tier 3–8 sources | Listed in tier table | No adapters | PR3/PR4 / post-Gate-A engines |

**`order_book_snapshot`:** The registry and `NormalizedObservationKind` include this kind for forward compatibility. PR2.5 delivers HTX MTF `ohlcv_bar` + L1 `quote_l1` only. Full Market Data Source Integration must either implement depth fetch + normalization or remove the kind from the registry — do not leave silent mismatch.

---

## Registry readiness matrix (Repeat M9)

| Registry ID | Declared kinds | Implemented via gateway | Repeat M9 |
|-------------|----------------|-------------------------|-----------|
| `htx_spot` | `ohlcv_bar`, `quote_l1`, `order_book_snapshot` | `ohlcv_bar`, `quote_l1` only | **Required** |
| `binance_public` | `cross_exchange_confirmation`, `quote_l1` | Yes | Required (fail-soft) |
| `bybit_public` | `cross_exchange_confirmation`, `quote_l1` | Yes | Required (fail-soft) |
| `alternative_me` | `fear_greed_index` | Yes | Required (fail-soft) |
| `coingecko_global` | `global_market_stats` | Yes | Required (fail-soft) |

---

## Operator documentation

| Document | Role |
|----------|------|
| [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) | Operator provisioning and verification |
| [`AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md) | Architect/operator sign-off |
| [`../cloudflare-env-vars.md`](../cloudflare-env-vars.md) | Cloudflare inventory |

Validation:

```bash
pnpm validate:provider-readiness
```

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
pnpm validate:provider-readiness
```

Grep guard: research modules must not import `connectors/binance`, `connectors/bybit`, `connectors/alternative-me`, `connectors/coingecko`, or `market-data-gateway` directly (`tests/unit/trader-research-backtest-isolation.test.ts`).
