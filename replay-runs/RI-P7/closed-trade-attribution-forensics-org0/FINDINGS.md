# M0 Phase 1 — Closed-Trade Attribution Forensics (Org-0)

**Campaign:** `closed-trade-attribution-pipeline-forensics-org0`  
**Branch:** `dee-372-m0-closed-trade-attribution-forensics`  
**Linear:** DEE-372  
**Generated:** 2026-07-04  
**Authority:** [AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md](../AI-TRADER-COMPLETION-PLAN-SNAPSHOT-BEFORE-M0.md) (M0 Phase 1 contract)

---

## Verdict

**PASS** — The defect is reproduced deterministically. Buy-only signals submit and fill, open positions remain at window end, aggregate `tradeCount` / `closedTradeCount` stays **0**, while `byRegime[].tradeCount` counts **submitted orders** and is **> 0**. This is a forensic capture of today's incorrect behavior, not a repair.

**No production code was repaired during M0 Phase 1.**

---

## End-to-end trace (signal → order → fill → position → no close → closedTradeCount)

The trace below follows one buy cycle through the research validation backtest path. Line numbers refer to the repository at M0 Phase 1 commit time on branch `dee-372-m0-closed-trade-attribution-forensics`.

### 1. Signal created

`runPaperCycleOnce` invokes `runEvaluationCycle` on each expanding bar window:

```99:106:lib/trader/paper/paper-cycle-runner.ts
  const evaluation = runEvaluationCycle({
    organizationId: context.organizationId,
    bars: snapshot.bars,
    quote: snapshot.quote,
    evaluatedAt: snapshot.evaluatedAt,
    newId: input.newId,
    telemetrySink: input.telemetrySink,
  });
```

Actionable signals are filtered to the active research strategy (`activeStrategyIds` from `runBacktest`):

```108:114:lib/trader/paper/paper-cycle-runner.ts
  const actionableSignals = evaluation.signals.filter(
    (signal) =>
      signal.outcome === "SIGNAL" &&
      (snapshot.activeStrategyIds === undefined ||
        snapshot.activeStrategyIds.length === 0 ||
        snapshot.activeStrategyIds.includes(signal.strategyId)),
  );
```

**Production analogue:** `trend_momentum_v0` emits `STRAT_TM_MOMENTUM_ENTRY` buy signals in `TREND_BULL`; zscore stays elevated so **no sell signal** is emitted before window end (`lib/trader/intelligence/strategies/trend-momentum-v0.ts`).

### 2. Order submitted

Each actionable signal is mapped to a submit payload:

```132:141:lib/trader/paper/paper-cycle-runner.ts
    const submit = mapSignalToSubmitOrder({
      signal,
      accountKey: input.accountKey,
      referencePrice: evaluation.features.features.close,
      executionMode,
      defaultQuantity: input.defaultQuantity,
      tradingPermission: evaluation.msv.derived.tradingPermission,
      clientOrderId: orderKeys.clientOrderId,
      idempotencyKey: orderKeys.idempotencyKey,
    });
```

`mapSignalToSubmitOrder` returns a market buy when `signal.outcome === "SIGNAL"` and side is set:

```42:67:lib/trader/paper/signal-to-order.ts
export function mapSignalToSubmitOrder(
  input: MapSignalToSubmitOrderInput,
): SubmitOrderInput | null {
  const { signal } = input;
  if (signal.outcome !== "SIGNAL" || !signal.side) {
    return null;
  }
  // ...
  return {
    // ...
    side: signal.side,
    type: "market",
    quantity: allocateQuantity(signal, input.referencePrice, input.defaultQuantity),
    strategySignalId: signal.strategySignalId,
    // ...
  };
}
```

Execution service is called; on success `execution.status === "submitted"`:

```154:167:lib/trader/paper/paper-cycle-runner.ts
    const execution = await deps.execution.submitOrder(context, {
      ...submit,
      accountState,
    });

    if (execution.status !== "submitted") {
      strategyExecutions.push({
        signal,
        submitBlocked: true,
        execution,
        reconciliation: null,
      });
      continue;
    }
```

### 3. Fill (mock)

`MockExchangeConnector.placeOrder` instant-fills market orders (`lib/trader/connectors/mock-exchange-connector.ts` L169–207). Fills are persisted via `execution-service` → `recordFill`. Cost model wraps fills in `runBacktest` (`lib/trader/backtest/backtest-runner.ts` L60–80).

### 4. Position opened

Net position is derived from FILLED orders only:

```44:65:lib/trader/paper/derive-paper-book.ts
export function netPositionsFromFilledOrders(
  orders: readonly FilledOrderSlice[],
): Map<string, string> {
  // buy adds quantity; sell subtracts
}
```

With buy-only fills and no sells, `derivePaperBook` reports **open quantity > 0** at window end.

### 5. No in-window SELL

`extractInWindowClosedTrades` only records closed trades when processing a **sell** fill inside the evaluation window. Buy fills hit `applyBuyFill` and `continue` — they never enter the closed-trade push:

```259:262:lib/trader/paper/derive-paper-pnl.ts
    if (order.side === "buy") {
      applyBuyFill(ledger, fill.price, fill.quantity, quoteFee);
      continue;
    }
```

There is **no** forced-flat mark-to-close, **no** stop-loss/take-profit engine, and **no** end-of-window synthetic close in v1 semantics.

### 6. closedTradeCount == 0

Closed trades are built exclusively from in-window sell fills:

```268:278:lib/trader/paper/derive-paper-pnl.ts
    if (inWindowFillIds.has(fill.id)) {
      closedTrades.push({
        fillId: fill.id,
        orderId: order.id,
        symbol: order.symbol,
        executedAt: fill.executedAt,
        quantity: fill.quantity,
        price: fill.price,
        tradePnl,
      });
    }
```

`derivePaperStrategyEvaluationFromEvents` passes these to `computeTradeStatistics`:

```280:285:lib/trader/paper/derive-paper-strategy-eval.ts
  const rawClosedTrades = extractInWindowClosedTrades(
    openingEvents,
    inWindowEvents,
    quoteCurrencyBySymbol,
  );
  const tradeStats = computeTradeStatistics(rawClosedTrades, periodRealizedPnl);
```

`closedTradeCount` is literally the length of that sell-only list:

```202:204:lib/trader/paper/derive-paper-strategy-eval.ts
  return {
    closedTrades: sortedTrades,
    closedTradeCount: sortedTrades.length,
```

**Result:** buy-only window → `closedTradeCount = 0` even with open inventory.

---

## Aggregate `tradeCount` semantics (v1)

In `runResearchValidationBacktest`, aggregate metrics are taken from paper strategy evaluation:

```124:127:lib/trader/research/research-backtest-runner.ts
  const aggregate = evaluations[0];
  const periodRealizedPnl = aggregate?.periodRealizedPnl ?? "0";
  const periodTotalFees = aggregate?.periodTotalFees ?? "0";
  const closedTradeCount = aggregate?.closedTradeCount ?? 0;
```

Returned as `ResearchValidationMetrics.tradeCount`:

```158:164:lib/trader/research/research-backtest-runner.ts
  return {
    schemaVersion: "1.0.0",
    tradeCount: closedTradeCount,
    periodRealizedPnl,
    periodTotalFees,
    byRegime,
  };
```

**Meaning (v1):** aggregate `tradeCount` === **`closedTradeCount`** === count of **in-window SELL fills** attributed as closed trades. It does **not** count submitted orders, open positions, or buy fills.

Type definition:

```49:55:lib/trader/research/strategy-candidate.types.ts
export type ResearchValidationMetrics = {
  schemaVersion: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
  byRegime: ResearchRegimeMetricSlice[];
};
```

(`RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION = "1.0.0"`.)

---

## `byRegime[].tradeCount` semantics (v1)

Per-regime slices are accumulated from **submitted** strategy executions per bar cycle, **not** from closed trades:

```97:112:lib/trader/research/research-backtest-runner.ts
  for (const cycle of backtest.cycleResults) {
    const regime = cycle.evaluation.msv.derived.regime;
    const submitted = cycle.strategyExecutions.filter(
      (entry) => entry.execution?.status === "submitted",
    );
    if (submitted.length === 0) {
      continue;
    }

    const current = regimeAccumulators.get(regime) ?? {
      tradeCount: 0,
      periodRealizedPnl: "0",
      periodTotalFees: "0",
    };
    current.tradeCount += submitted.length;
    regimeAccumulators.set(regime, current);
  }
```

**Meaning (v1):** `byRegime[].tradeCount` === count of **submitted orders** per CDE regime label across cycles. PnL/fees in slices stay `"0"` until `closedTradeCount > 0` triggers allocation (L129–146).

---

## Why aggregate and byRegime diverge

| Layer | Field | Counts | Source |
|-------|-------|--------|--------|
| Aggregate | `tradeCount` | In-window **closed** round-trips (sell fills only) | `derivePaperStrategyEval` → `extractInWindowClosedTrades` |
| byRegime | `tradeCount` | **Submitted** orders per regime | `backtest.cycleResults` → `execution.status === "submitted"` |

When a strategy (or fixture) submits buys but never sells:

- Aggregate `tradeCount` = **0** (no sell fills → no closed trades).
- `byRegime[].tradeCount` = **N > 0** (one increment per submitted buy cycle).

The promotion gate reads **byRegime** submitted-order slices:

```31:42:lib/trader/research/regime-coverage.ts
export function collectRegimeLabelsFromMetrics(
  metrics: readonly ResearchValidationMetrics[],
): string[] {
  const labels = new Set<string>();
  for (const entry of metrics) {
    for (const slice of entry.byRegime) {
      if (slice.tradeCount > 0) {
        labels.add(slice.regimeLabel);
      }
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}
```

So a campaign can show **regime activity in byRegime** while aggregate **tradeCount remains 0** — exactly the RI-P7 Signal Attribution Investigation outcome (`trackBByRegimeSubmittedOrders: 18`, `trackBAggregateTradeCount: 0`).

---

## v1 → v2 metric mapping table

Planned under M0 Phase 2 (`RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION` bump to `"2.0.0"`). v1 artifacts remain read-only legacy.

| v1 field / behavior | v2 explicit field | v2 semantics (planned) |
|---------------------|-------------------|-------------------------|
| `tradeCount` (aggregate) | `closedTrades` | Real in-window SELL round-trips only |
| *(not present)* | `markToCloseTrades` | Synthetic forced-flat at window boundary |
| *(not present)* | `submittedOrders` | Orders dispatched to connector |
| *(not present)* | `acceptedOrders` | Passed risk (not `risk_rejected`) |
| *(not present)* | `filledOrders` | Orders reaching `FILLED` |
| *(not present)* | `openPositions` | Open qty > 0 at boundary (pre forced-flat) |
| `periodRealizedPnl` | `realizedPnl` | PnL from real closes only |
| *(not present)* | `markedPnl` | `realizedPnl` + forced-flat mark-to-close PnL |
| byRegime `tradeCount` (submitted) | `byRegime[].submittedOrders` (and aligned fields) | Same taxonomy at regime level |
| *(implicit)* | `rejectedSignals` | Risk/guard blocks |
| *(implicit)* | `skippedSignals` | NO_SIGNAL / strategy-not-allowed |

**Invariant (M0 Phase 2):** every countable/summable v2 field must satisfy **aggregate == sum(byRegime)** for the same field name.

---

## Deterministic forensic test

| Item | Value |
|------|-------|
| **File** | `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` |
| **Suite** | `M0 closed-trade attribution forensics (DEE-372 Phase 1)` |
| **Test name** | `forensic regression: buy-only window yields zero closedTradeCount while submitted orders and open position exist` |

The test mocks buy-only `trend_momentum_v0` signals in `TREND_BULL`, runs `runResearchValidationBacktest` over 30 fixture bars, and **asserts current wrong behavior**:

- `filledBuyOrders.length > 0`
- `filledSellOrders.length === 0`
- open position exists in `derivePaperBook`
- `metrics.tradeCount === 0`
- `sum(byRegime[].tradeCount) > 0`
- aggregate `tradeCount !== sum(byRegime tradeCount)`

---

## Files created (M0 Phase 1 only)

| Path | Purpose |
|------|---------|
| `tests/unit/trader-closed-trade-attribution-forensics-m0.test.ts` | Deterministic forensic regression test |
| `replay-runs/RI-P7/closed-trade-attribution-forensics-org0/FINDINGS.md` | This report |

**Not modified:** any file under `lib/`, any existing `replay-runs/**` artifact, sealed investigation vaults, blind evidence.

---

## Validation commands executed

```bash
pnpm lint
pnpm typecheck
pnpm test --run
git status --short
```

---

## Recommendation for M0 Phase 2

Proceed only after **Human Review** of this report and the passing forensic test.

M0 Phase 2 (per approved plan) should:

1. Introduce `CLOSED_TRADE_SEMANTICS_VERSION` / `TRADE_LIFECYCLE_SEMANTICS_VERSION` and bump metrics schema to `2.0.0`.
2. Implement forced-flat mark-to-close at window boundary per H2 (boundary-bar close, `applyCostToFill` sell side, `syntheticClose: true`, `markedPnl` not `realizedPnl`).
3. Replace ambiguous `tradeCount` with explicit taxonomy on aggregate **and** byRegime; enforce aggregate == sum(byRegime).
4. **Never** mutate existing sealed v1 artifacts or blind results — write new rows/files only.

**Do not** redesign strategies, change CDE, or consume blind in Phase 2 without explicit operator authorization.

---

*End of M0 Phase 1 findings. Stop for Human Review before M0 Phase 2.*
