import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertFeatureParity,
  findFeatureParityMismatches,
  FEATURE_ENGINE_PARITY_CONTRACT_VERSION,
} from "@/lib/trader/intelligence/feature-engine-parity";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

function loadFixture(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

describe("feature engine parity contract (DEE-199)", () => {
  it("exports a stable contract version", () => {
    expect(FEATURE_ENGINE_PARITY_CONTRACT_VERSION).toBe("1.0.0");
  });

  it("asserts identical live/backtest snapshots for same inputs", () => {
    const fixture = loadFixture();
    const input = {
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "parity-id",
    };
    const live = computeFeatureSnapshot(input);
    const backtest = computeFeatureSnapshot(input);
    expect(findFeatureParityMismatches(live, backtest)).toHaveLength(0);
    expect(() => assertFeatureParity(live, backtest)).not.toThrow();
  });

  it("detects parity mismatches", () => {
    const fixture = loadFixture();
    const live = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "a",
    });
    const backtest = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "b",
    });
    expect(
      findFeatureParityMismatches(live, backtest).some((m) => m.field === "featureSetId"),
    ).toBe(true);
  });
});
