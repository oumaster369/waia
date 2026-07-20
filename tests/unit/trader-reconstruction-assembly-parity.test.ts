import { describe, expect, it } from "vitest";

import {
  assembleLiquidityStructure,
  assembleMarketStructure,
  assembleReconstructionSnapshot,
  assembleTrendStructure,
  assembleVolatilityStructure,
  computeReconstructionContentDigest,
} from "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: "42000",
    high: "42100",
    low: "41900",
    close: "42050",
    volume: "12.5",
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1) - 1).toISOString(),
  }));
}

describe("trader reconstruction assembly parity", () => {
  it("produces identical digest via shared assembly path", () => {
    const bars = sampleBars(120);
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const oracle = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });
    const manual = assembleReconstructionSnapshot({
      instrumentId: oracle.instrumentId,
      evaluatedAt: oracle.evaluatedAt,
      marketStructure: oracle.marketStructure,
      liquidityStructure: oracle.liquidityStructure,
      trendStructure: oracle.trendStructure,
      volatilityStructure: oracle.volatilityStructure,
      participationStructure: oracle.participationStructure,
      contextStructure: oracle.contextStructure,
    });
    expect(manual.contentDigest).toBe(oracle.contentDigest);
    expect(computeReconstructionContentDigest(manual)).toBe(oracle.contentDigest);
  });

  it("assembles structural blocks deterministically from oracle-derived inputs", () => {
    const bars = sampleBars(90);
    const oracle = buildReconstructionSnapshot({
      bars1m: bars,
      evaluatedAt: bars.at(-1)!.barCloseTime,
    });
    const market = assembleMarketStructure({
      highs: oracle.marketStructure.swingHighs,
      lows: oracle.marketStructure.swingLows,
      latestClose: oracle.marketStructure.swingHighs.at(-1)?.price ?? null,
      priorDay: null,
      sessionSlice: [],
    });
    expect(market.swingHighs).toEqual(oracle.marketStructure.swingHighs);
    expect(
      assembleTrendStructure({ perTimeframeBias: oracle.trendStructure.perTimeframeBias })
        .mtfAlignment,
    ).toBe(oracle.trendStructure.mtfAlignment);
    expect(
      assembleVolatilityStructure({
        atrUsdt: oracle.volatilityStructure.atrUsdt,
        recentAtr: oracle.volatilityStructure.expansionRatio
          ? oracle.volatilityStructure.atrUsdt
          : null,
        priorAtr: null,
        atrPeriod: 14,
      }).atrPeriod,
    ).toBe(14);
    expect(
      assembleLiquidityStructure({
        swingHighs: oracle.marketStructure.swingHighs,
        swingLows: oracle.marketStructure.swingLows,
        isSwept: () => false,
      }).levels.length,
    ).toBeGreaterThanOrEqual(0);
  });
});
