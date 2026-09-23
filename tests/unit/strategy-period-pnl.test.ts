import { describe, expect, it } from "vitest";

import { strategyPeriodPnl } from "@/lib/trader/research-v2/strategy-period-pnl";

describe("strategy period pnl", () => {
  it("sums only closed trades of that strategy in the current and previous UTC months", () => {
    const result = strategyPeriodPnl({
      strategyId: "mean-reversion",
      now: new Date("2026-09-23T12:00:00.000Z"),
      trades: [
        {
          strategyId: "mean-reversion",
          state: "CLOSED",
          closedAt: "2026-09-02T00:00:00.000Z",
          realizedPnl: "10",
        },
        {
          strategyId: "mean-reversion",
          state: "OPEN",
          closedAt: null,
          realizedPnl: "99",
        },
        {
          strategyId: "other",
          state: "CLOSED",
          closedAt: "2026-09-03T00:00:00.000Z",
          realizedPnl: "50",
        },
        {
          strategyId: "mean-reversion",
          state: "FORCED_FLAT",
          closedAt: "2026-08-31T23:00:00.000Z",
          realizedPnl: "-2.5",
        },
      ],
    });
    expect(result.currentMonth.amount).toBe("10");
    expect(result.currentMonth.closedTrades).toBe(1);
    expect(result.currentMonth.start).toBe("2026-09-01T00:00:00.000Z");
    expect(result.previousMonth.amount).toBe("-2.5");
    expect(result.previousMonth.closedTrades).toBe(1);
  });
});
