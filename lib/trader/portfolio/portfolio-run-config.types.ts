/**
 * Run-level portfolio configuration (not persisted — seeded per backtest/research/paper run).
 *
 * `defaultStopDistancePct` is a risk-sizing assumption only; consumed by
 * {@link DefaultStopDistanceProvider}, not strategy logic or final stop-loss orders.
 */
export type PortfolioRunConfig = {
  startingBalanceUsdt: string;
  /** Decimal fraction, e.g. `"0.02"` = 2% of entry for provisional stop distance. */
  defaultStopDistancePct: string;
  /** Minimum order quantity (dust floor). */
  minOrderQty?: string;
};

export const DEFAULT_PORTFOLIO_RUN_CONFIG: PortfolioRunConfig = {
  startingBalanceUsdt: "100000.00",
  defaultStopDistancePct: "0.02",
  minOrderQty: "0.00001",
};
