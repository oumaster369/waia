import { describe, expect, it } from "vitest";

import {
  assertClosedTradeRealityInvariants,
  ClosedTradeInvariantError,
} from "@/lib/trader/lifecycle/htr-closed-trade-invariants";

describe("HTR-WP20 closed trade invariants", () => {
  it("closed-trade gross/net sums match accounting state", () => {
    expect(() =>
      assertClosedTradeRealityInvariants({
        closedTrades: [
          {
            tradeId: "t1",
            symbol: "BTCUSDT",
            grossRealizedPnl: "10",
            netRealizedPnl: "7",
            closedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            tradeId: "t2",
            symbol: "ETHUSDT",
            grossRealizedPnl: "5",
            netRealizedPnl: "4",
            closedAt: "2026-01-01T01:00:00.000Z",
          },
        ],
        accountingGrossRealized: "15",
        accountingNetRealized: "11",
      }),
    ).not.toThrow();
  });

  it("closed-trade mismatch fails closed", () => {
    expect(() =>
      assertClosedTradeRealityInvariants({
        closedTrades: [
          {
            tradeId: "t1",
            symbol: "BTCUSDT",
            grossRealizedPnl: "10",
            netRealizedPnl: "7",
            closedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        accountingGrossRealized: "9",
        accountingNetRealized: "7",
      }),
    ).toThrow(ClosedTradeInvariantError);
  });
});
