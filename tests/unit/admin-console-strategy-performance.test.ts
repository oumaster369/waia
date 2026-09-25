import { describe, it, expect } from "vitest";
import {
  strategyPerformance,
  type StrategyPerformanceTrade,
} from "@/lib/trader/admin-console/research/strategy-performance";
import { compareResearchRuns } from "@/lib/trader/admin-console/research/compare-runs";
const trade: StrategyPerformanceTrade = {
  id: "t",
  organizationId: "a",
  account: "real",
  symbol: "BTCUSDT",
  state: "CLOSED",
  closedAt: "2026-09-24T12:00:00.000Z",
  reasons: [],
  legs: [
    {
      kind: "OPEN",
      executedAt: "2026-09-23T12:00:00.000Z",
      legPnl: "0",
      fee: "1",
      feeAsset: "USDT",
      price: "100",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    },
    {
      kind: "CLOSE",
      executedAt: "2026-09-24T12:00:00.000Z",
      legPnl: "8",
      fee: "2",
      feeAsset: "USDT",
      price: "110",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    },
  ],
};
describe("version-scoped operational performance", () => {
  it("counts each opening/closing fee once and distinguishes period from lifetime closed-trade stats", () => {
    const full = strategyPerformance([trade], "2026-09-23", "2026-09-25");
    expect(full).toMatchObject({
      realized: "7",
      tradingFees: "3",
      openFees: "1",
      closeFees: "2",
      closedTradeCount: 1,
      winRate: "1",
      profitFactor: null,
    });
    expect(full.daily.map((d) => d.realized)).toEqual(["-1", "8"]);
    expect(full.maxRealizedDrawdown).toBe("1");
    const day = strategyPerformance([trade], "2026-09-24", "2026-09-25");
    expect(day.realized).toBe("8");
    expect(day.trades[0].realized).toBe("7");
  });
  it("does not hide an intraday realized drawdown inside a profitable daily bucket", () => {
    const intraday = {
      ...trade,
      legs: trade.legs.map((l) => ({
        ...l,
        executedAt: l.kind === "OPEN" ? "2026-09-24T10:00:00.000Z" : l.executedAt,
      })),
    };
    const result = strategyPerformance([intraday], "2026-09-24", "2026-09-25");
    expect(result.daily.map((d) => d.realized)).toEqual(["7"]);
    expect(result.maxRealizedDrawdown).toBe("1");
  });
  it("never totals incomplete, conflicting or unsupported fee evidence", () => {
    expect(
      strategyPerformance([{ ...trade, reasons: ["OWNERSHIP_CONFLICT"] }], "2026", "2027").realized,
    ).toBeNull();
    expect(strategyPerformance([trade], "2026", "2027", true).realized).toBeNull();
    expect(
      strategyPerformance(
        [{ ...trade, legs: trade.legs.map((l) => ({ ...l, feeAsset: "BTC" })) }],
        "2026",
        "2027",
      ).reasons,
    ).toContain("CLOSE_FEE_DENOMINATION_UNVERIFIED");
  });
  it("does not equate absent conditions or duplicate profitability and forecast quality", () => {
    const r = {
      id: "a",
      dataset: null,
      period: null,
      costs: null,
      version: null,
      model: null,
      netPnl: "0",
      forecastQuality: null,
    };
    expect(compareResearchRuns([r, { ...r, id: "b" }])).toMatchObject({
      sameConditions: false,
      unknownConditions: ["dataset", "period", "costs", "version", "model"],
      profitability: [
        { id: "a", netPnl: "0" },
        { id: "b", netPnl: "0" },
      ],
      forecastQuality: [
        { id: "a", forecastQuality: null },
        { id: "b", forecastQuality: null },
      ],
    });
  });
});
