import { describe, expect, it } from "vitest";

import {
  computeFeatureSnapshot,
  FEATURE_ENGINE_RV_VERSION,
} from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar } from "@/lib/trader/intelligence/types";

function makeBar(index: number, close: string): Bar {
  const openMs = Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000;
  const closeMs = openMs + 59_999;
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "100",
    barOpenTime: new Date(openMs).toISOString(),
    barCloseTime: new Date(closeMs).toISOString(),
  };
}

function makeConsecutiveBars(count: number, closeFn: (index: number) => string): Bar[] {
  return Array.from({ length: count }, (_, index) => makeBar(index, closeFn(index)));
}

describe("feature-engine/rv/v2", () => {
  it("exports FEATURE_ENGINE_RV_VERSION", () => {
    expect(FEATURE_ENGINE_RV_VERSION).toBe("feature-engine/rv/v2");
  });

  it("constant price yields RV=0", () => {
    const bars = makeConsecutiveBars(25, () => "100.00000000");
    const snapshot = computeFeatureSnapshot({ bars });
    expect(snapshot.features.realizedVar20m_1m).toBe("0");
    expect(snapshot.features.realizedVol20m_1m).toBe("0");
  });

  it("fixed log-step g yields RV=sqrt(20)*g", () => {
    const g = 0.001;
    const bars = makeConsecutiveBars(25, (index) => formatExp(index * g, 100));
    const snapshot = computeFeatureSnapshot({ bars });
    const expectedVar = 20 * g * g;
    expect(Number(snapshot.features.realizedVar20m_1m)).toBeCloseTo(expectedVar, 8);
    expect(Number(snapshot.features.realizedVol20m_1m)).toBeCloseTo(Math.sqrt(expectedVar), 8);
  });

  it("missing bar in window yields UNAVAILABLE", () => {
    const bars = makeConsecutiveBars(25, () => "100.00000000");
    const gapIndex = bars.length - 5;
    bars[gapIndex] = {
      ...bars[gapIndex]!,
      barOpenTime: new Date(Date.parse(bars[gapIndex]!.barOpenTime) + 120_000).toISOString(),
      barCloseTime: new Date(Date.parse(bars[gapIndex]!.barCloseTime) + 120_000).toISOString(),
    };
    const snapshot = computeFeatureSnapshot({ bars });
    expect(snapshot.features.realizedVar20m_1m).toBe("UNAVAILABLE");
    expect(snapshot.features.realizedVol20m_1m).toBe("UNAVAILABLE");
  });

  it("deprecates realizedVol20 as priceDispersion20 alias", () => {
    const bars = makeConsecutiveBars(25, (index) => String(100 + index));
    const snapshot = computeFeatureSnapshot({ bars });
    expect(snapshot.features.priceDispersion20).toBe(snapshot.features.realizedVol20);
  });
});

function formatExp(logStep: number, base: number): string {
  return (base * Math.exp(logStep)).toFixed(8);
}
