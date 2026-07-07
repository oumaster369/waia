import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCrowdPsychologyLayer,
  buildFutureContextLayer,
  buildLiquidityLayer,
  buildMarketPhysicsLayer,
} from "@/lib/trader/intelligence/analytical-layers-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

function loadFixture(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

describe("analytical layers v0 (DEE-200)", () => {
  it("builds physics and liquidity layers from features", () => {
    const fixture = loadFixture();
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
    });

    expect(buildMarketPhysicsLayer(features)).toEqual({
      close: features.features.close,
      zscoreVsSma20: features.features.zscoreVsSma20,
      realizedVol20: features.features.realizedVol20,
    });
    expect(buildLiquidityLayer(features)).toEqual({
      spreadBps: features.features.spreadBps,
    });
  });

  it("keeps crowd and future context as MVP stubs without fused context", () => {
    expect(buildCrowdPsychologyLayer()).toEqual({
      fearGreedIndex: null,
      newsSentiment: "0",
    });
    expect(buildFutureContextLayer()).toEqual({
      eventRiskScore: "0",
      sessionPhase: "UNKNOWN",
      asianRangeCorridorPresent: false,
    });
  });
});
