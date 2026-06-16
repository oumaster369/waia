import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeFeatureSnapshot,
  isInsufficientBars,
} from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

type FixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadFixture(): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("trader intelligence feature engine v0 (DEE-257)", () => {
  it("loads golden fixture and computes stable feature values", () => {
    const fixture = loadFixture();
    const snapshot = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "feature-set-golden",
    });

    expect(snapshot.featureSetId).toBe("feature-set-golden");
    expect(snapshot.features.close).toBe("64000.00");
    expect(snapshot.features.sma20).toBe("64850");
    expect(compareDecimal(snapshot.features.zscoreVsSma20, "-1.5")).toBeLessThanOrEqual(0);
    expect(snapshot.dataQualityScore).toBeGreaterThanOrEqual(0.5);
    expect(snapshot.inputs.barCount).toBe(25);
  });

  it("reduces dataQualityScore when bars have gaps", () => {
    const fixture = loadFixture();
    const gappedBars = fixture.bars.map((bar, index) =>
      index === 10
        ? {
            ...bar,
            barOpenTime: new Date(Date.parse(bar.barOpenTime) + 120_000).toISOString(),
            barCloseTime: new Date(Date.parse(bar.barCloseTime) + 120_000).toISOString(),
          }
        : bar,
    );

    const clean = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
    });
    const gapped = computeFeatureSnapshot({
      bars: gappedBars,
      quote: fixture.latestQuote,
      evaluatedAt: gappedBars.at(-1)!.barCloseTime,
    });

    expect(gapped.dataQualityScore).toBeLessThan(clean.dataQualityScore);
  });

  it("flags insufficient bars", () => {
    const fixture = loadFixture();
    expect(isInsufficientBars(fixture.bars.slice(0, 5))).toBe(true);
    expect(isInsufficientBars(fixture.bars)).toBe(false);
  });
});
