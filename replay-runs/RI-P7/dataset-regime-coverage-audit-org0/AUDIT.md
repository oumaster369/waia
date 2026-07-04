# M0.5 — Dataset / Regime Coverage Audit (Org-0)

**Campaign:** `dataset-regime-coverage-audit-org0`  
**Branch:** `dee-372-m0-closed-trade-attribution-forensics`  
**Linear:** DEE-372  
**Generated:** 2026-07-04  
**Authority:** AI-TRADER Completion Plan — M0.5 contract (audit-only; no strategy tuning, no gate weakening, no sealed-artifact mutation, no blind consumption)

---

## Verdict

**PASS (audit complete)** — The sealed Org-0 BTC/USDT 1m window **contains sufficient bar-level regime diversity** for ADR-0010 bucket coverage, but **trade-attributed multi-regime coverage remains strategy- and classifier-constrained**. CDE v0 **never emits `STRESS`**. Lifecycle-correct M0 (v2 metrics + forced-flat) **removes the zero-attribution pipeline defect** but **does not alone guarantee** `MULTI_REGIME_COVERAGE_INSUFFICIENT` clearance for single-strategy campaigns (`trend_momentum_v0` is structurally one-regime; `mean_reversion_v0` had zero submissions on Org-0).

**No production logic was changed during M0.5.**

---

## 1. Original M0.5 findings (contract)

### 1.1 Sealed Org-0 dataset metadata

| Field | Value | Source |
|-------|-------|--------|
| Dataset ID | `ba4b5397-7706-46ed-80d9-b8a3aeb8a832` | S1 forensics |
| Symbol / interval | BTC/USDT · 1m | sealed metadata |
| Total bars | **129,602** (≥ 129,600 minimum) | S1 forensics |
| Split | train 77,761 / validation 25,920 / blind 25,921 | S1 forensics |
| Sealed at | 2026-07-03T06:49:51.367Z | S1 forensics |

Data integrity confirmed in prior signal-attribution investigation; this audit does **not** re-verify digests against Postgres (read-only workstation scope).

### 1.2 CDE v0 never emits `STRESS`

Production classifier (`lib/trader/intelligence/cde-v0.ts`):

```22:34:lib/trader/intelligence/cde-v0.ts
export function classifyRegime(features: FeatureSnapshot): Regime {
  const zscore = features.features.zscoreVsSma20;
  if (compareDecimal(zscore, "-2") <= 0) {
    return "TREND_BEAR";
  }
  if (compareDecimal(zscore, "2") >= 0) {
    return "TREND_BULL";
  }
  if (compareDecimal(zscore, "-0.5") >= 0 && compareDecimal(zscore, "0.5") <= 0) {
    return "CHOP";
  }
  return "RANGE";
}
```

**Emits only:** `TREND_BEAR`, `TREND_BULL`, `CHOP`, `RANGE`.

**Never emits:** `STRESS`, `PANIC`, `LIQUIDITY_VACUUM`, `EVENT_RISK`, `LOW_EDGE`, `UNKNOWN`.

Canonical RI vocabulary includes `STRESS` (`lib/trader/research/regime-taxonomy.ts`), and the coverage gate treats `TREND_BEAR|STRESS` as the down bucket (`lib/trader/research/regime-coverage.ts`), but **`STRESS` is unreachable from CDE v0**. Down-regime bar and trade attribution both depend on **`TREND_BEAR` only**.

**Empirical confirmation:** read-only proxy analysis over **129,581** classifiable 20-bar windows (129,600 HTX 1m bars, same count class as Org-0) → `STRESS: 0` (`regime-analysis-proxy.json`).

### 1.3 Regime distribution (quantified)

Proxy analysis uses public HTX kline fetch + production `computeFeatureSnapshot` + `classifyRegime`. **Not digest-verified against Org-0 sealed bars** — same symbol, interval, and bar-count class (~90 days). See `regime-analysis-proxy.json`.

| Regime | Bars (windows) | Share |
|--------|----------------:|------:|
| RANGE | 85,367 | 65.88% |
| CHOP | 28,942 | 22.34% |
| TREND_BEAR | 7,953 | 6.14% |
| TREND_BULL | 7,319 | 5.65% |
| **STRESS** | **0** | **0%** |

**Bar-level gate buckets:**

| Bucket | Labels | Bar count | Present? |
|--------|--------|----------:|----------|
| Non-trending | RANGE \| CHOP | 114,309 | yes (88.21%) |
| Down | TREND_BEAR \| STRESS | 7,953 | yes (6.14%; all TREND_BEAR) |

`evaluateMultiRegimeCoverage` on observed bar regimes → **`satisfiesRequirement: true`** at bar level.

### 1.4 Gate satisfiability — bar level vs trade-attributed level

**Coverage gate (ADR-0010 bundle):** requires trade-attributed activity in **both** non-trending **and** down buckets (`assertResearchPipelineRegimeCoverage` → `collectRegimeLabelsFromMetrics` → `regimeSliceHasAttributedRoundTrips`).

**M0 Phase 2 field (explicit):** `countAttributedRoundTrips(slice) = closedTrades + markToCloseTrades` (`lib/trader/research/research-validation-metrics-taxonomy.ts`).

| Layer | Org-0 pre-M0 campaigns | Post-M0 v2 (lifecycle-correct) | Verdict |
|-------|--------------------------|--------------------------------|---------|
| Bar presence | non-trending + down bars exist | unchanged | sufficient |
| Trade attribution (MR `@0.1.0`) | `closedTradeCount: 0`, `byRegime: []` | forced-flat can attribute **if** strategy submits + fills | **still blocked until MR submits** |
| Trade attribution (TM `@0.1.0`) | aggregate 0; byRegime TREND_BULL submits only | forced-flat attributes **TREND_BULL only** | **gate still fails** (no non-trending/down attribution) |
| STRESS bucket | never emitted | never emitted | down bucket = TREND_BEAR only |

**Why Org-0 failed `MULTI_REGIME_COVERAGE_INSUFFICIENT` (H4 decomposition):**

1. **Primary (pre-M0):** attribution pipeline counted only in-window SELL fills as closed trades; buy-only paths → aggregate 0 everywhere (documented in M0 Phase 1 FINDINGS.md).
2. **Secondary (strategy × CDE gating):** `trend_momentum_v0` excluded in RANGE/CHOP/TREND_BEAR; `mean_reversion_v0` excluded in TREND_BULL — single-strategy campaigns cannot cover all buckets alone.
3. **Tertiary (classifier):** `STRESS` in gate vocabulary but unreachable; stress-like conditions collapse into `TREND_BEAR` or `RANGE`.
4. **Not a dataset bar shortage:** 129,602 bars with ~88% non-trending and ~6% bear windows.

**Lifecycle-correct M0 alone:** fixes (1) for strategies that submit; does **not** fix (2) TM-only promotion path or (3) STRESS taxonomy gap.

---

## A. Dataset quality audit

Evaluation target: sufficiency for a future **autonomous AI Trader** learning over sealed historical windows.

| Dimension | Finding | Evidence |
|-----------|---------|----------|
| **Regime diversity** | Moderate — four CDE labels present; STRESS absent | Proxy: 5.65% bull, 6.14% bear, 88.21% sideways |
| **Volatility diversity** | Good — wide realizedVol20 spread | min 1.78 · median 43.39 · max 721.91; high-vol share 27.16% |
| **Trend diversity** | Moderate — short max consecutive runs | max consecutive: RANGE 42, CHOP 15, TREND_BEAR 12, TREND_BULL 9 bars |
| **Reversal diversity** | Good | 15,427 z-score zero crosses; 15,426 sign flips |
| **Sideways diversity** | Strong | RANGE+CHOP 88.21% (RANGE-heavy) |
| **Crisis / panic coverage** | **Not modeled** | CDE v0 has no PANIC/STRESS path; extreme vol appears as TREND_BEAR or high realizedVol20 only |
| **Recovery coverage** | Partial proxy | 3,923 bear→non-bear regime transitions |
| **Breakout diversity** | Present | 3,728 bull / 3,923 bear z≥±2 crosses |
| **False breakout diversity** | Present (heuristic) | ~810 false bull / ~813 false bear within 5 bars |
| **Event diversity** | **Not measurable** | Sealed datasets = OHLCV only; no event timeline bound to bars |

**Gaps for autonomous trading:** single asset (BTC), single interval (1m), no macro/news/calendar features, no labeled stress/panic regime, no cross-asset correlation windows.

---

## B. Knowledge readiness audit

Can existing datasets support future **Pattern Discovery → Pattern KB → Strategy Generator → Learning Loop**?

| Capability | Ready? | Missing information |
|------------|--------|---------------------|
| **Pattern Discovery** | Partial | OHLCV + zscore/vol features sufficient for **structural** pattern mining; no event-labeled episodes, no multi-timeframe alignment, no liquidity/spread history in sealed bars |
| **Pattern Knowledge Base** | Schema only | `lib/trader/mi/pattern-service.ts` registers inert pattern definitions; **no runtime evaluator/scorer** (M6) |
| **Strategy Generator** | No | No hypothesis→code pipeline (M8); MVP strategies are hand-authored registry entries |
| **Learning Loop** | No | Trials/evidence spine exists (MI Layer-5a) but **requires attributable trades + exit reasons**; pre-M0 zero closes blocked loop closure |

**Precise missing inputs for knowledge loop:**

1. Attributed round-trip records with regime at entry/exit (M0 v2 partial; M1 lineage partial)
2. Exit reason codes / guardian intents (M3–M5)
3. Pattern match scores over bar windows (M6)
4. Event→price attribution records (M7)
5. Deposit-aware PnL and portfolio context (M2)
6. STRESS/crisis regime labels or equivalent stress features for down-bucket science

---

## C. Execution intelligence readiness

Future modules: **Position Guardian**, **Exit Intelligence**, **Execution Intelligence**.

### Captured today

| Attribute | Location | Notes |
|-----------|----------|-------|
| Order header | `trader_orders` | symbol, side, qty, state, strategySignalId, riskDecisionId |
| Lifecycle events | `trader_order_events` | state transitions, reconciliation, fill_recorded |
| Fills | `trader_fills` | price, qty, fee, executedAt |
| Cost model version | research metrics | `waia.trader.cost-model.v1` |
| Regime at cycle | MSV envelope | per-bar CDE regime |
| v2 trade taxonomy | research metrics v2 | submitted/filled/closed/markToClose counts by regime |
| Synthetic mark-to-close | `PaperMarkToCloseTrade` | boundary price, fees, tradePnl — **no exit reason** |

### Missing for future learning (blocks Guardian / Exit / Execution intelligence)

| Missing attribute | Why it matters | Milestone |
|-------------------|----------------|-----------|
| Per-position open timestamp / entry regime | Guardian time-in-trade, regime-shift exits | M1, M3 |
| Stop-loss / take-profit levels | Dynamic SL/TP learning | M4 |
| Exit intent + reason code | Auditable exit intelligence | M3, M5 |
| Partial close / reduce events | Scale-out learning | M5 |
| Slippage vs reference at submit | Execution quality attribution | M9+ |
| Latency signal→fill | Execution intelligence | M1 trace |
| Multi-position concurrency state | Portfolio guardian | M1, M2 |
| Trailing stop path | Exit policy learning | M4 |
| Event/risk-off trigger at exit | Contextual exit memory | M5, M7 |
| Guardian bar-by-bar monitor record | Replayable exit decisions | M3 |

**Conclusion:** execution ** plumbing** exists; execution ** intelligence** attributes for learning do not.

---

## D. Dataset readiness matrix

Scores: **0** absent · **1** minimal · **2** partial · **3** adequate for MVP research · **4** strong · **5** production-grade autonomous readiness

| Dimension | Score | Evidence | Reasoning | Recommended milestone |
|-----------|------:|----------|-----------|----------------------|
| **Dataset completeness** | 3 | 129,602 BTC 1m bars; 90-day span; splits sealed | Meets RI program minimum; single-asset/interval | Dataset expansion milestone (multi-asset, 15m/1h, crisis windows) post-M1 |
| **Regime diversity** | 2 | 4/5 canonical labels at bar level; STRESS=0 | Classifier collapses stress; sideways-heavy (~88%) | CDE v1 stress detector OR dataset tagging milestone (recommend only; do not edit CDE in M0.5) |
| **Pattern diversity** | 2 | Breakout/reversal/sideways episodes present | No labeled patterns; feature dimension low (sma20 zscore, vol20) | M6 pattern catalog activation |
| **Execution diversity** | 1 | Mock instant fill; no SL/TP paths | Cannot learn exit policies from history | M3–M5 + M9 campaign |
| **Knowledge readiness** | 2 | MI registry + evidence spine | No evaluator; no autonomous registration | M6–M8 |
| **Discovery readiness** | 1 | No pattern-discovery job | Hypothesis generation manual | M8 |
| **Guardian readiness** | 0 | Zero guardian code | No per-bar position monitor | M3 |
| **Overall readiness** | **2** | Bar store OK; learning loop blocked on lifecycle + exits + classifier gaps | Research can resume after M1; promotion still needs multi-regime **trade** attribution | M1 → re-run v2 campaign on non-blind splits only |

---

## Architectural conclusions

1. **Dataset is not the binding blocker** for Org-0 `MULTI_REGIME_COVERAGE_INSUFFICIENT` — bar-level buckets are populated.
2. **Classifier–gate mismatch:** gate references `STRESS`; CDE v0 never produces it. Operational down bucket = **`TREND_BEAR` only**.
3. **Strategy–gate mismatch:** MVP strategies are regime-gated to disjoint allow-lists; **no single MVP strategy can satisfy multi-regime trade attribution alone**.
4. **M0 lifecycle repair is necessary but not sufficient** for promotion: v2 `markToCloseTrades` enables attributed round-trips where strategies submit; TM-only paths remain single-regime.
5. **Autonomous AI Trader** requires M1–M8 stack before datasets translate into self-improving strategies.

---

## Recommendations for future milestones

| Priority | Milestone | Action |
|----------|-----------|--------|
| P0 | **M1** | Trade lifecycle entities + order trace — prerequisite for trustworthy attribution replay on sealed windows |
| P1 | **Post-M1 v2 re-campaign** | Re-run validation split only (no blind) with `metricsSchemaVersion: "2.0.0"` and MR/TM separately; measure `countAttributedRoundTrips` per regime bucket |
| P1 | **Classifier / dataset follow-up** | Recommend STRESS detection spec (vol spike + drawdown?) as separate ADR + CDE v1 — **not implemented in M0.5** |
| P2 | **Dataset construction** | Add ETH/USDT, crisis window overlays (e.g. 2020-03, 2022-11 slices), optional 15m aggregation |
| P2 | **M2–M5** | Deposit-aware sizing + guardian + exits — required for execution intelligence learning |
| P3 | **M6–M8** | Pattern catalog, events, autonomous strategy generation |

---

## Validation

| Check | Result |
|-------|--------|
| `pnpm test --run` | see §Validation results below |
| Sealed artifact mutation | none |
| Blind consumption | none |
| Strategy tuning | none |
| Gate weakening | none |
| CDE edits | none |

---

## Artifacts

| File | Purpose |
|------|---------|
| `AUDIT.md` | This report |
| `regime-analysis-proxy.json` | Quantitative regime/diversity metrics (HTX proxy, read-only) |
| `../scripts/trader/audit-dataset-regime-coverage-readonly.ts` | Optional read-only analysis script (no DB writes) |

---

## Stop condition

**Human review before M1.** Repository state: **`READY_FOR_HUMAN_REVIEW_BEFORE_M1`**.

M0.5 **does not block** M1 (may proceed in parallel per plan). Do **not** auto-advance to blind re-run or strategy v0.2.0 campaigns until M1 + operator authorization.

---

*End of M0.5 Dataset / Regime Coverage Audit.*
