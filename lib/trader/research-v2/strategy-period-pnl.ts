import { addDecimal } from "@/lib/trader/risk/numeric";

const CLOSED_STATES = new Set(["CLOSED", "FORCED_FLAT"]);

export type StrategyClosedTrade = {
  strategyId: string;
  state: string;
  closedAt: string | null;
  realizedPnl: string;
};

export type StrategyMonthPnl = {
  amount: string;
  closedTrades: number;
  start: string;
  end: string;
};

function monthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1));
}

function inHalfOpen(closedAt: string, start: Date, end: Date): boolean {
  const at = Date.parse(closedAt);
  return Number.isFinite(at) && at >= start.getTime() && at < end.getTime();
}

function sumMonth(
  trades: readonly StrategyClosedTrade[],
  strategyId: string,
  start: Date,
  end: Date,
): StrategyMonthPnl {
  const matched = trades.filter(
    (trade) =>
      trade.strategyId === strategyId &&
      CLOSED_STATES.has(trade.state) &&
      trade.closedAt !== null &&
      inHalfOpen(trade.closedAt, start, end),
  );
  return {
    amount: matched.reduce((total, trade) => addDecimal(total, trade.realizedPnl), "0"),
    closedTrades: matched.length,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/** Current and previous UTC calendar months. Open trades are excluded. */
export function strategyPeriodPnl(input: {
  strategyId: string;
  trades: readonly StrategyClosedTrade[];
  now: Date;
}): { currentMonth: StrategyMonthPnl; previousMonth: StrategyMonthPnl } {
  const year = input.now.getUTCFullYear();
  const month = input.now.getUTCMonth();
  const currentStart = monthStart(year, month);
  const nextStart = monthStart(year, month + 1);
  const previousStart = monthStart(year, month - 1);
  return {
    currentMonth: sumMonth(input.trades, input.strategyId, currentStart, nextStart),
    previousMonth: sumMonth(input.trades, input.strategyId, previousStart, currentStart),
  };
}
