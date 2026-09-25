import { operationalRealizedPnl, type OperationalLeg } from "../money/operational-pnl";
import { strategyTradeStats } from "./strategy-stats";
import { addDecimal, subtractDecimal, compareDecimal } from "@/lib/trader/risk/numeric";
export type StrategyPerformanceTrade = {
  id: string;
  organizationId: string;
  account: string | null;
  symbol: string;
  state: string;
  closedAt: string | null;
  legs: OperationalLeg[];
  reasons: string[];
};
export function strategyPerformance(
  trades: readonly StrategyPerformanceTrade[],
  start: string,
  end: string,
  truncated = false,
) {
  const reasons = [...new Set(trades.flatMap((t) => t.reasons))];
  if (truncated) reasons.push("STRATEGY_TRADES_TRUNCATED");
  const legs = trades.flatMap((t) => t.legs),
    period = operationalRealizedPnl(legs, start, end);
  reasons.push(...period.reasons);
  const closed = trades.filter(
    (t) => t.state !== "OPEN" && t.closedAt !== null && t.closedAt >= start && t.closedAt < end,
  );
  const closedResults = closed.map((t) => operationalRealizedPnl(t.legs, "0000", "9999"));
  for (const r of closedResults) reasons.push(...r.reasons);
  const stats = strategyTradeStats(
    closedResults.flatMap((r) => (r.realized === null ? [] : [r.realized])),
  );
  const dates = [
    ...new Set(
      legs
        .filter((l) => l.executedAt >= start && l.executedAt < end)
        .map((l) => l.executedAt.slice(0, 10)),
    ),
  ].sort();
  let cumulative = "0",
    peak = "0",
    drawdown = "0";
  // Preserve intraday realized losses; daily chart buckets must not hide drawdown.
  const ordered = legs
    .filter((l) => l.executedAt >= start && l.executedAt < end)
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  for (const leg of ordered) {
    const value = operationalRealizedPnl([leg], start, end).realized;
    if (value === null) continue;
    cumulative = addDecimal(cumulative, value);
    if (compareDecimal(cumulative, peak) > 0) peak = cumulative;
    const dd = subtractDecimal(peak, cumulative);
    if (compareDecimal(dd, drawdown) > 0) drawdown = dd;
  }
  cumulative = "0";
  const daily = dates.map((day) => {
    const v = operationalRealizedPnl(
      legs.filter((l) => l.executedAt.startsWith(day)),
      start,
      end,
    );
    if (v.realized !== null) {
      cumulative = addDecimal(cumulative, v.realized);
    }
    return { day, realized: v.realized, cumulative: v.realized === null ? null : cumulative };
  });
  const valid = reasons.length === 0;
  return {
    state: !valid ? ("partial" as const) : trades.length ? ("ok" as const) : ("empty" as const),
    reasons: [...new Set(reasons)],
    currency: "USDT" as const,
    method: "operational_realized_legs/v1",
    realized: valid ? period.realized : null,
    tradingFees: valid ? period.tradingFees : null,
    openFees: valid ? period.openFees : null,
    closeFees: valid ? period.closeFees : null,
    closedTradeCount: valid ? stats.count : null,
    winRate: valid ? stats.winRate : null,
    profitFactor: valid ? stats.profitFactor : null,
    maxRealizedDrawdown: valid ? drawdown : null,
    accountCount: valid
      ? new Set(trades.map((t) => `${t.organizationId}:${t.account}`)).size
      : null,
    daily: valid ? daily : [],
    trades: trades.slice(0, 50).map((t) => ({
      id: t.id,
      organizationId: t.organizationId,
      account: t.account,
      symbol: t.symbol,
      state: t.state,
      closedAt: t.closedAt,
      realized: t.reasons.length ? null : operationalRealizedPnl(t.legs, "0000", "9999").realized,
    })),
    totalTrades: trades.length,
    truncated,
  };
}
export type StrategyPerformance = ReturnType<typeof strategyPerformance>;
