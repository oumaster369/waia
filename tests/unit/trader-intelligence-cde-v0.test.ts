import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

type FixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadFixture(): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("trader intelligence CDE v0 (DEE-257)", () => {
  it("sets ALLOW_TRADING on golden fixture path", () => {
    const fixture = loadFixture();
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "feature-set-cde",
    });
    const msv = buildMsvEnvelope({ features, newId: () => "msv-golden" });

    expect(msv.derived.tradingPermission).toBe("ALLOW_TRADING");
    expect(msv.derived.allowedStrategyIds).toContain("mean_reversion_v0");
    expect(msv.derived.dataQualityScore).toBe(features.dataQualityScore);
  });

  it("sets PAPER_ONLY when data quality is below threshold", () => {
    const lowQuality = {
      featureSetId: "feature-set-low-quality",
      instrumentId: "BTC/USDT" as const,
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      features: {
        close: "64000.00",
        sma20: "64850",
        zscoreVsSma20: "-2.5",
        realizedVol20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.2,
      inputs: { barCount: 25 },
    };
    const msv = buildMsvEnvelope({ features: lowQuality, newId: () => "msv-paper-only" });

    expect(msv.derived.tradingPermission).toBe("PAPER_ONLY");
  });
});
