# M0 Phase 3 — Closed-Trade Attribution Repair Validation (Org-0)

**Campaign:** `closed-trade-attribution-pipeline-forensics-org0`  
**Branch:** `dee-372-m0-closed-trade-attribution-forensics`  
**Linear:** DEE-372  
**Generated:** 2026-07-04  
**Authority:** [AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md](../AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md) (M0 Phase 3 contract)

---

## Verdict

**PASS** — The v2 semantics repair produces attributable round-trips on a **non-sealed** buy-only fixture, satisfies aggregate == sum(byRegime) for every taxonomy field, reconciles `markedPnl` to forced-flat economics, stamps required semantics versions, and is byte-identical across two consecutive deterministic runs.

**No sealed artifacts were mutated.** Legacy v1 forensic regression remains unchanged.

---

## Fixture (non-sealed)

| Field | Value |
|-------|-------|
| `datasetId` | `dataset-m0-phase3-non-sealed` |
| `runId` | `run-m0-phase3-validation` |
| Strategy | `trend_momentum_v0` @ `0.1.0` |
| Bars | 30 × 1m flat `BTC/USDT` @ `65000.00` |
| Window | `2026-01-01T00:00:00.000Z` → `2026-01-01T00:30:00.000Z` |
| `exportedAt` | `2026-01-01T00:30:00.000Z` (pinned) |
| In-window clock | `2026-01-01T00:15:00.000Z` (pinned `nowMs`) |
| Cost model | `waia.trader.cost-model.v1` — fees `10` bps, slippage `5` bps |
| Id factory | `m0-phase3-id-{n++}` (deterministic counter) |
| Metrics schema | `"2.0.0"` via `metricsSchemaVersion: "2.0.0"` |

Signal path: mocked buy-only `TREND_BULL` evaluation (same shape as Phase 2 v2 tests). No blind consumption. No Execution Server campaign. No live.

Automated regression references:

- `tests/unit/trader-closed-trade-attribution-v2.test.ts` — H2 forced-flat math, taxonomy coherence, determinism
- `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` — permanent v1 legacy capture (unchanged)

---

## Proof (a) — Attributed round-trips > 0

```
closedTrades + markToCloseTrades = 0 + 1 = 1  (> 0)
```

| Metric | Aggregate |
|--------|-----------|
| `closedTrades` | `0` (no in-window SELL fills) |
| `markToCloseTrades` | `1` (forced-flat at boundary) |
| `submittedOrders` | `10` |
| `openPositions` (pre forced-flat) | `1` |

---

## Proof (b) — aggregate == sum(byRegime) per metric

All countable and summable taxonomy fields reconcile between aggregate and `byRegime[0]` (`TREND_BULL`):

| Field | Aggregate | sum(byRegime) | Match |
|-------|-----------|---------------|-------|
| `submittedOrders` | 10 | 10 | yes |
| `acceptedOrders` | 10 | 10 | yes |
| `filledOrders` | 10 | 10 | yes |
| `openPositions` | 1 | 1 | yes |
| `closedTrades` | 0 | 0 | yes |
| `markToCloseTrades` | 1 | 1 | yes |
| `rejectedSignals` | 1 | 1 | yes |
| `skippedSignals` | 0 | 0 | yes |
| `realizedPnl` | `0` | `0` | yes |
| `markedPnl` | `-5.3456485` | `-5.3456485` | yes |
| `periodTotalFees` | `0` | `0` | yes |

Enforced in code by `assertResearchValidationMetricsV2Coherence` (`lib/trader/research/research-validation-metrics-taxonomy.ts`).

---

## Proof (c) — markedPnl reconciliation

Forced-flat mark-to-close at boundary bar close via `applyCostToFill(side="sell")`:

| Item | Value |
|------|-------|
| `realizedPnl` (real SELL fills only) | `0` |
| `markToCloseTrades[0].tradePnl` | `-5.3456485` |
| `sum(markToCloseTrades[].tradePnl)` | `-5.3456485` |
| `markedPnl` (aggregate) | `-5.3456485` |

**Identity:**

```
markedPnl == realizedPnl + sum(markToCloseTrades[].tradePnl)
-5.3456485 == 0 + (-5.3456485)   ✓
```

Synthetic close record:

```json
{
  "syntheticId": "synthetic-flat:BTC/USDT",
  "symbol": "BTC/USDT",
  "executedAt": "2026-01-01T00:30:00.000Z",
  "quantity": "0.0153846",
  "boundaryClosePrice": "65000.00",
  "adjustedSellPrice": "64967.5",
  "sellFee": "0.999499",
  "tradePnl": "-5.3456485",
  "syntheticClose": true
}
```

Evaluation-level check: `periodMarkedPnl == periodRealizedPnl + sum(markToClose tradePnl)` → `-5.3456485 == 0 + (-5.3456485)` ✓

---

## Proof (d) — realizedPnl reconciliation

| Source | `realizedPnl` |
|--------|---------------|
| Aggregate v2 metrics | `0` |
| Strategy evaluation `periodRealizedPnl` | `0` |
| In-window real SELL closed trades | none |

**Identity:** `metrics.realizedPnl == evaluation.periodRealizedPnl` → `0 == 0` ✓

---

## Proof (e) — Semantics + cost-model versions stamped

| Field | Observed | Expected |
|-------|----------|----------|
| `schemaVersion` | `2.0.0` | `2.0.0` |
| `closedTradeSemanticsVersion` | `waia.trader.closed-trade.v2` | `waia.trader.closed-trade.v2` |
| `tradeLifecycleSemanticsVersion` | `waia.trader.trade-lifecycle.v1` | `waia.trader.trade-lifecycle.v1` |
| `costModelVersion` | `waia.trader.cost-model.v1` | `waia.trader.cost-model.v1` |

Constants: `lib/trader/paper/trade-lifecycle-semantics.ts`, `lib/trader/execution/cost-model.ts`.

---

## Proof (f) — Deterministic reproducibility

Two consecutive fixture runs with:

- pinned `exportedAt = 2026-01-01T00:30:00.000Z`
- pinned in-window `nowMs = 2026-01-01T00:15:00.000Z`
- deterministic id factory `m0-phase3-id-{n++}` (no `crypto.randomUUID()`, no `Date.now()`)

**Result:** `JSON.stringify(metricsRunA) === JSON.stringify(metricsRunB)` → **byte-identical** ✓

Also covered by `tests/unit/trader-closed-trade-attribution-v2.test.ts` → `"deterministic id factory produces byte-identical metrics across two runs"`.

---

## Proof (g) — Legacy v1 artifacts untouched

| Check | Result |
|-------|--------|
| `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` | unchanged; still asserts v1 `schemaVersion === "1.0.0"`, `tradeCount === 0` |
| Sealed `replay-runs/**` artifacts | not modified (only new `VALIDATION.md` added under campaign folder) |
| Postgres / blind / PKA rows | not written by this phase |

`git status` at validation time showed no modifications to tracked sealed paths; campaign folder remained untracked except for additive docs.

---

## Full v2 metrics snapshot (run A)

```json
{
  "schemaVersion": "2.0.0",
  "closedTradeSemanticsVersion": "waia.trader.closed-trade.v2",
  "tradeLifecycleSemanticsVersion": "waia.trader.trade-lifecycle.v1",
  "costModelVersion": "waia.trader.cost-model.v1",
  "submittedOrders": 10,
  "acceptedOrders": 10,
  "filledOrders": 10,
  "openPositions": 1,
  "closedTrades": 0,
  "markToCloseTrades": 1,
  "realizedPnl": "0",
  "markedPnl": "-5.3456485",
  "periodTotalFees": "0",
  "rejectedSignals": 1,
  "skippedSignals": 0,
  "byRegime": [
    {
      "regimeLabel": "TREND_BULL",
      "submittedOrders": 10,
      "acceptedOrders": 10,
      "filledOrders": 10,
      "openPositions": 1,
      "closedTrades": 0,
      "markToCloseTrades": 1,
      "realizedPnl": "0",
      "markedPnl": "-5.3456485",
      "periodTotalFees": "0",
      "rejectedSignals": 1,
      "skippedSignals": 0
    }
  ]
}
```

---

## Validation commands

```bash
pnpm test --run tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts
pnpm test --run tests/unit/trader-closed-trade-attribution-v2.test.ts
pnpm test --run
git status --short
```

All passed at report generation time.

---

## Stop gate

Human review required before **M0.5** (dataset/regime coverage audit). Do not auto-advance.
