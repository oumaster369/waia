# M2 Deposit / Portfolio / Risk Sizing — DESIGN

**Linear:** DEE-377 · **Branch:** `dee-377-m2-portfolio-risk-sizing` · **Semantics:** `PORTFOLIO_RISK_SEMANTICS_VERSION_V1`

## Objective

USDT spot-only deposit-aware portfolio ledger, stop-based position sizing, and capital-limit enforcement — without changing M0 closed-trade taxonomy or M1 lifecycle pairing.

## Core modules

| Module | Role |
|--------|------|
| `lib/trader/portfolio/portfolio-account.types.ts` | `PortfolioAccountState` — 12-field ledger snapshot |
| `lib/trader/portfolio/stop-distance-provider.types.ts` | `StopDistanceProvider` contract |
| `lib/trader/portfolio/default-stop-distance-provider.ts` | M2 provisional distance via `RUN_DEFAULT_PCT` |
| `lib/trader/portfolio/stop-based-sizing.ts` | Deterministic qty from equity, stop distance, caps |
| `lib/trader/portfolio/derive-portfolio-account-state.ts` | Cash + PnL + open risk from fills |
| `lib/trader/portfolio/to-account-risk-state.ts` | Adapter into legacy `AccountRiskState` |

## Stop distance boundary

- Runners and sizing **never** compute pct math directly.
- `defaultStopDistancePct` on `PortfolioRunConfig` is a **risk-sizing assumption only** — not a placed stop order.
- M4+ providers swap via injection; M2 ships `DefaultStopDistanceProvider` with `source: "RUN_DEFAULT_PCT"`.

## Sizing placement

`computeStopBasedQuantity` runs in `paper-cycle-runner` **before** risk engine submit. Capital evaluator remains reject-only (preserves trade-abuse RESIZE semantics).

## Risk limits schema

New columns on `trader_risk_limits` (SQLite `0039`, Postgres `0069`):

- `max_risk_per_trade_pct`
- `max_portfolio_risk_pct`
- `max_concurrent_positions`

**No new RLS migration** — existing `0011_trader_risk_limits_rls.sql` covers the table.

## Integration paths

| Path | M2 behavior |
|------|-------------|
| Backtest | Optional `portfolio` context; refresh ledger between bars |
| Research v2 | Generous deposit (`RESEARCH_V2_PORTFOLIO`); M0/M1 metrics parity |
| Paper cycle | Stop-based sizing + portfolio refresh when `portfolio` set |
| Paper loop | Env `PAPER_LOOP_STARTING_BALANCE_USDT`, `PAPER_LOOP_DEFAULT_STOP_DISTANCE_PCT` |

## Legacy account-state path (intentional)

`deriveAccountRiskStateFromMockOrders` remains for **non-portfolio callers** (fixture replay, research v1 forensic parity, legacy scripts). It uses buy-only quote exposure and zero PnL fields.

**M2 deposit-aware paths** must use `derivePortfolioAccountState` + `toAccountRiskState` (paper loop, portfolio-enabled paper cycle, research v2, optional backtest `portfolio` input).

## Explicit non-goals (M2)

- No Guardian / SL / TP / exits modules
- No strategy file edits
- No sealed M0/M1 artifact mutation
- `reservedMarginUsdt === "0"` always (spot)

## Provisional stop caveat

Until M4, stop distance is a sizing assumption tagged `RUN_DEFAULT_PCT`. Documented here and in run config types — not interpreted as exchange stop orders.
