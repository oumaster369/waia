import { describe, expect, it } from "vitest";

import { presentClosedTrade } from "@/lib/trader/admin-console/handlers/closed-trades";
import { presentFill } from "@/lib/trader/admin-console/handlers/fills";
import { tradePeriodBounds } from "@/lib/trader/admin-console/read-models/trade-period";

describe("fills and closed trades", () => {
  it("keeps fill and trade amounts as text", () => {
    const fill = presentFill({
      id: "f-1",
      organizationId: "org-1",
      orderId: "o-1",
      symbol: "BTCUSDT",
      price: "100.50",
      quantity: "0.01",
      fee: "0.00001",
      feeAsset: "BTC",
      executedAt: "2026-09-23T00:00:00.000Z",
      historicalRunId: null,
      executionMode: "paper",
    });
    expect(fill.fee).toBe("0.00001");
    expect(fill.price).toBe("100.50");
    expect(fill.mode).toBe("paper");
    const trade = presentClosedTrade({
      id: "t-1",
      organizationId: "org-1",
      symbol: "BTCUSDT",
      strategyId: "mean-reversion",
      strategyVersion: "1",
      state: "FORCED_FLAT",
      realizedPnl: "-2.25",
      closedAt: "2026-09-23T00:00:00.000Z",
    });
    expect(trade.realizedPnl).toBe("-2.25");
    expect(trade.label).toBe("Принудительно закрыта");
  });

  it("bounds a closed-trade period as a half-open interval", () => {
    const now = new Date("2026-09-23T15:00:00.000Z");
    expect(tradePeriodBounds({ period: "today", now })).toEqual({
      start: "2026-09-23T00:00:00.000Z",
      end: "2026-09-23T15:00:00.000Z",
    });
    expect(tradePeriodBounds({ period: "7d", now }).start).toBe("2026-09-16T15:00:00.000Z");
    expect(
      tradePeriodBounds({
        period: "custom",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-02T00:00:00.000Z",
        now,
      }),
    ).toEqual({
      start: "2026-09-01T00:00:00.000Z",
      end: "2026-09-02T00:00:00.000Z",
    });
  });
});
