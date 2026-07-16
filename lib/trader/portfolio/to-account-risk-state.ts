import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { computePeakEquityDrawdownBps } from "@/lib/trader/risk/drawdown-policy-evaluator";
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

import type { PortfolioAccountState } from "@/lib/trader/portfolio/portfolio-account.types";

export type Wp16AccountRiskState = AccountRiskState & {
  accountPeakHwm?: string;
  monthlyPeakHwm?: string;
};

export type ToAccountRiskStateInput = {
  portfolio: PortfolioAccountState;
  openOrderCount: number;
  quoteExposureUsdt?: string;
  /** HTR-WP16: running account peak-equity HWM (defaults to current equity). */
  accountPeakHwm?: string;
  /** HTR-WP16: calendar-month peak-equity HWM (defaults to account peak). */
  monthlyPeakHwm?: string;
};

/**
 * Maps M2 portfolio ledger into legacy {@link AccountRiskState} for the risk engine.
 * Populates M2 portfolio extension fields when present.
 */
export function toAccountRiskState(input: ToAccountRiskStateInput): Wp16AccountRiskState {
  const { portfolio } = input;
  const dailyPnl = subtractDecimal(portfolio.equityUsdt, portfolio.startingBalanceUsdt);
  const accountPeak = input.accountPeakHwm ?? portfolio.equityUsdt;
  const drawdownBps = computePeakEquityDrawdownBps(portfolio.equityUsdt, accountPeak);
  const drawdown =
    drawdownBps > 0
      ? subtractDecimal(accountPeak, portfolio.equityUsdt)
      : compareDecimal(portfolio.equityUsdt, portfolio.startingBalanceUsdt) < 0
        ? subtractDecimal(portfolio.startingBalanceUsdt, portfolio.equityUsdt)
        : "0";

  const quoteExposure =
    input.quoteExposureUsdt ??
    subtractDecimal(portfolio.startingBalanceUsdt, portfolio.availableBalanceUsdt);

  const normalizedExposure = compareDecimal(quoteExposure, "0") < 0 ? "0" : quoteExposure;

  return {
    positions: portfolio.positions.map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
    })),
    openOrderCount: input.openOrderCount,
    dailyPnl,
    drawdown,
    quoteExposureByCurrency: { USDT: normalizedExposure },
    availableBalanceUsdt: portfolio.availableBalanceUsdt,
    equityUsdt: portfolio.equityUsdt,
    openRiskUsdt: portfolio.openRiskUsdt,
    openPositionCount: portfolio.openPositionCount,
    projectedOrderRiskUsdt: "0",
    accountPeakHwm: input.accountPeakHwm ?? portfolio.equityUsdt,
    monthlyPeakHwm: input.monthlyPeakHwm ?? input.accountPeakHwm ?? portfolio.equityUsdt,
  };
}

/** Adds projected new-trade risk-at-stop for capital portfolio-risk check. */
export function withProjectedOrderRisk(
  state: AccountRiskState,
  projectedRiskUsdt: string,
): AccountRiskState {
  return {
    ...state,
    projectedOrderRiskUsdt: projectedRiskUsdt,
  };
}

export function mergeProjectedOpenRisk(state: AccountRiskState): string {
  const base = state.openRiskUsdt ?? "0";
  const projected = state.projectedOrderRiskUsdt ?? "0";
  return addDecimal(base, projected);
}
