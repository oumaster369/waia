import { describe, expect, it } from "vitest";

import {
  operationalRealizedPnl,
  type OperationalLeg,
} from "@/lib/trader/admin-console/money/operational-pnl";

function leg(
  overrides: Partial<OperationalLeg> & Pick<OperationalLeg, "kind" | "executedAt">,
): OperationalLeg {
  return {
    legPnl: "0",
    fee: "0",
    feeAsset: "USDT",
    price: "100",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    ...overrides,
  };
}

describe("operational pnl", () => {
  it("puts a buy fee in P1 and partial closes in P2 and P3", () => {
    const legs = [
      leg({ kind: "OPEN", executedAt: "2026-01-02T00:00:00.000Z", fee: "1" }),
      leg({ kind: "CLOSE", executedAt: "2026-02-02T00:00:00.000Z", legPnl: "4" }),
      leg({ kind: "CLOSE", executedAt: "2026-03-02T00:00:00.000Z", legPnl: "6" }),
    ];
    expect(
      operationalRealizedPnl(legs, "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z").realized,
    ).toBe("-1");
    expect(
      operationalRealizedPnl(legs, "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z").realized,
    ).toBe("4");
    expect(
      operationalRealizedPnl(legs, "2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z").realized,
    ).toBe("6");
  });

  it("converts a base-asset open fee once and refuses an unknown fee asset", () => {
    const base = operationalRealizedPnl(
      [
        leg({
          kind: "OPEN",
          executedAt: "2026-01-02T00:00:00.000Z",
          fee: "0.01",
          feeAsset: "BTC",
          price: "100",
        }),
      ],
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    );
    expect(base.realized).toBe("-1");
    const foreign = operationalRealizedPnl(
      [leg({ kind: "OPEN", executedAt: "2026-01-02T00:00:00.000Z", fee: "1", feeAsset: "DOGE" })],
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    );
    expect(foreign.state).toBe("partial");
    expect(foreign.realized).toBeNull();
    expect(foreign.reasons).toContain("FEE_ASSET_UNCONVERTIBLE");
  });
});
