import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findFeatureParityMismatches } from "@/lib/trader/intelligence/feature-engine-parity";
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

  it("is PIT-prefix invariant when future bars exist outside the anchor prefix", () => {
    const bars = makeConsecutiveBars(30, (index) => formatExp(index * 0.001, 100));
    const anchor = computeFeatureSnapshot({ bars: bars.slice(0, 25), newId: () => "anchor" });
    const futureMutated = bars.map((bar, index) =>
      index < 25 ? bar : { ...bar, close: String(Number(bar.close) * 100) },
    );
    const replay = computeFeatureSnapshot({
      bars: futureMutated.slice(0, 25),
      newId: () => "replay",
    });

    expect(replay.features.priceDispersion20).toBe(anchor.features.priceDispersion20);
    expect(replay.features.realizedVar20m_1m).toBe(anchor.features.realizedVar20m_1m);
    expect(replay.features.realizedVol20m_1m).toBe(anchor.features.realizedVol20m_1m);
    expect(replay.features.realizedVol20).toBe(replay.features.priceDispersion20);
  });

  it.each([
    "priceDispersion20",
    "realizedVar20m_1m",
    "realizedVol20m_1m",
  ] as const)("detects a parity mutation in canonical RV field %s", (field) => {
    const bars = makeConsecutiveBars(25, (index) => formatExp(index * 0.001, 100));
    const live = computeFeatureSnapshot({ bars, newId: () => "same-id" });
    const backtest = computeFeatureSnapshot({ bars, newId: () => "same-id" });
    backtest.features[field] = backtest.features[field] === "0" ? "1" : "0";

    expect(findFeatureParityMismatches(live, backtest)).toContainEqual(
      expect.objectContaining({ field: `features.${field}` }),
    );
  });

  it("fails closed when a new runtime realizedVol20 consumer appears", () => {
    const repositoryRoot = process.cwd();
    const actual = walkTsFiles(path.join(repositoryRoot, "lib"))
      .filter((file) => /\brealizedVol20\b/u.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(repositoryRoot, file))
      .sort();

    expect(actual).toEqual([...CLASSIFIED_RUNTIME_SURFACES].sort());
  });
});

const CLASSIFIED_RUNTIME_SURFACES = [
  "lib/trader/events/event-attribution-pass.ts",
  "lib/trader/events/event-attribution-rules.ts",
  "lib/trader/events/event-attribution.types.ts",
  "lib/trader/events/event-classifier.ts",
  "lib/trader/intelligence/analytical-layers-v0.ts",
  "lib/trader/intelligence/feature-engine-parity.ts",
  "lib/trader/intelligence/feature-engine-v0.ts",
  "lib/trader/intelligence/strategies/liquidity-sweep-reversal-v0.ts",
  "lib/trader/intelligence/strategies/mean-reversion-v0.ts",
  "lib/trader/intelligence/strategies/trend-momentum-v0.ts",
  "lib/trader/intelligence/types.ts",
  "lib/trader/mi/pattern-catalog-pass.ts",
  "lib/trader/mi/pattern-catalog-scoring.ts",
  "lib/trader/mi/pattern-catalog.types.ts",
] as const;

function walkTsFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const absolute = path.join(root, entry);
    return statSync(absolute).isDirectory()
      ? walkTsFiles(absolute)
      : absolute.endsWith(".ts")
        ? [absolute]
        : [];
  });
}

function formatExp(logStep: number, base: number): string {
  return (base * Math.exp(logStep)).toFixed(8);
}
