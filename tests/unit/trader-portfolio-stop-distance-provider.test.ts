import { describe, expect, it } from "vitest";

import type { StrategySignal } from "@/lib/trader/intelligence/types";
import {
  defaultStopDistanceProvider,
  resolveDefaultStopDistance,
} from "@/lib/trader/portfolio/default-stop-distance-provider";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";

const SIGNAL: StrategySignal = {
  strategySignalId: "sig-1",
  strategyId: "mean_reversion_v0",
  strategyVersion: "0",
  organizationId: "org-1",
  symbol: "BTC/USDT",
  outcome: "SIGNAL",
  side: "buy",
  reasonCodes: [],
  msvId: "msv-1",
  featureSetId: "fs-1",
  evaluatedAt: "2026-01-01T00:00:00.000Z",
};

describe("DefaultStopDistanceProvider (M2)", () => {
  it("returns deterministic RUN_DEFAULT_PCT stop distance", () => {
    const first = resolveDefaultStopDistance({
      entryPrice: "65000.00",
      symbol: "BTC/USDT",
      side: "buy",
      signal: SIGNAL,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.02" },
    });
    const second = resolveDefaultStopDistance({
      entryPrice: "65000.00",
      symbol: "BTC/USDT",
      side: "buy",
      signal: SIGNAL,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.02" },
    });

    expect(first).toEqual(second);
    expect(first.source).toBe("RUN_DEFAULT_PCT");
    expect(first.stopDistanceUsdt).toBe("1300");
  });

  it("provider object matches resolveDefaultStopDistance", () => {
    const viaProvider = defaultStopDistanceProvider.resolveStopDistance({
      entryPrice: "100.00",
      symbol: "BTC/USDT",
      side: "buy",
      signal: SIGNAL,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.05" },
    });
    expect(viaProvider.stopDistanceUsdt).toBe("5");
    expect(viaProvider.source).toBe("RUN_DEFAULT_PCT");
  });

  it("rejects zero or negative defaultStopDistancePct", () => {
    expect(() =>
      resolveDefaultStopDistance({
        entryPrice: "100.00",
        symbol: "BTC/USDT",
        side: "buy",
        signal: SIGNAL,
        runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0" },
      }),
    ).toThrow(/defaultStopDistancePct/);
  });
});
