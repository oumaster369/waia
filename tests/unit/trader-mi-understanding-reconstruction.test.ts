import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import {
  RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
  type ReconstructionSnapshot,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";

function loadFixture() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

function withRegimeBias(
  reconstruction: ReconstructionSnapshot,
  regimeBias: ReconstructionSnapshot["trendStructure"]["regimeBias"],
  mtfAlignment: ReconstructionSnapshot["trendStructure"]["mtfAlignment"] = "ALIGNED",
): ReconstructionSnapshot {
  return {
    ...reconstruction,
    trendStructure: {
      ...reconstruction.trendStructure,
      regimeBias,
      mtfAlignment,
    },
  };
}

describe("trader understanding reconstruction integration (PR-2)", () => {
  it("classifyRegimeHint reflects reconstruction when supplied", () => {
    const fixture = loadFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const legacy = buildMarketUnderstandingBridge({ fusedContext, features });
    const reconstruction = buildReconstructionSnapshot({ bars1m: fixture.bars, evaluatedAt });
    const rangeReconstruction = withRegimeBias(reconstruction, "RANGE");
    const withReconstruction = buildMarketUnderstandingBridge({
      fusedContext,
      features,
      reconstruction: rangeReconstruction,
    });

    expect(withReconstruction.regimeHint).toBe("RANGING");
    expect(legacy.regimeHint).not.toBe("RANGING");
  });

  it("preserves legacy understanding when reconstruction is omitted", () => {
    const fixture = loadFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const first = buildMarketUnderstandingBridge({ fusedContext, features });
    const second = buildMarketUnderstandingBridge({ fusedContext, features });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.regimeHint).toBeTruthy();
  });

  it("maps reconstruction chop bias to CHOPPING regime hint", () => {
    const fixture = loadFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const reconstruction = buildReconstructionSnapshot({ bars1m: fixture.bars, evaluatedAt });
    const chopReconstruction: ReconstructionSnapshot = {
      ...reconstruction,
      schemaVersion: RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
      trendStructure: {
        ...reconstruction.trendStructure,
        regimeBias: "CHOP",
        mtfAlignment: "CONFLICTING",
      },
    };

    const understanding = buildMarketUnderstandingBridge({
      fusedContext,
      features,
      reconstruction: chopReconstruction,
    });

    expect(understanding.regimeHint).toBe("CHOPPING");
  });
});
