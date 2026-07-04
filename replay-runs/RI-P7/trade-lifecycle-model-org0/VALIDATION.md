# M1 Trade Lifecycle Model — VALIDATION

**Linear:** DEE-376 · **Date:** 2026-07-04

## Deterministic proofs

| Criterion | Evidence |
|-----------|----------|
| Multi-position FIFO | `tests/unit/trader-lifecycle-pairing.test.ts` — 2 concurrent open lots |
| Partial close | Same file — `remainingQty` stays OPEN |
| Partial fill → partial leg | Same file — partial buy fill qty `1` on order qty `2` |
| FIFO consume order | Same file — oldest lot closed first (`realizedPnl = 10`) |
| Forced-flat synthetic leg (pure) | Same file — `FORCED_FLAT` leg, `fillId: null` |
| Terminal trade freeze | `tests/unit/trader-lifecycle-repository.test.ts` — `TradeFrozenError` |
| Forced-flat persistence | Same file — persisted `FORCED_FLAT` leg, no new `trader_fills` |
| Lineage immutability | Same file — `assertTradeLineageImmutable` rejects mutation |
| Fill → trade wiring | Same file — recorder creates trade + lot + `TRADE_OPENED` event |
| Lifecycle vs fill-walk parity | Same file + `research-backtest-runner.ts` v2 when `lifecycleRecorder` present |
| §3B defaults | Pairing test — `LONG` / `SPOT` / semantics v2 |
| M0 regression | `trader-closed-trade-attribution-forensics-m0.test.ts`, `trader-closed-trade-attribution-v2.test.ts` (unchanged assertions) |

## Validation commands

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
```

## Taxonomy behavior (v2 research backtest)

When `deps.lifecycleRecorder` is wired (research session / in-memory backtest):

1. **Fill-walk remains the operational metrics source** for v2 aggregate and `byRegime` slices (`derivePaperStrategyEvaluations`).
2. **Forced-flat at window boundary** is persisted via `recordForcedFlatLifecycle` → `TradeLegKind.FORCED_FLAT` rows (never `trader_fills`).
3. **Dual-run parity assertion** (`assertLifecycleFillWalkTaxonomyParity`) compares fill-walk closed/mark-to-close counts and PnL sums against `deriveTradesFromFills` lifecycle snapshot; mismatch throws `LifecycleFillWalkParityError`.
4. When lifecycle recorder is absent, behavior is unchanged from M0 (fill-walk only).

`tradeLifecycleSemanticsVersion` stamps `waia.trader.trade-lifecycle.v2` on new metrics rows when imported from `@/lib/trader/paper/trade-lifecycle-semantics`.

## Human review stop

M1 complete — proceed to M2 only after human review of this package.
