import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReplayFusedContext,
  buildReplayFusedContextFromSnapshot,
  type ReplayProviderSidecar,
} from "@/lib/trader/market-data/replay-fused-context-builder";
import type { ReplayProviderSidecarV1 } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

function loadSidecar(): ReplayProviderSidecar {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/m9-provider-sidecar.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

describe("PR2.6 replay fused context builder", () => {
  it("builds deterministic fused context from replay bars", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;

    const first = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const second = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.mtfBars["1m"]).toBeDefined();
    expect(first.mtfBars["15m"]).toBeDefined();
    expect(first.crossVenueTriangulation).toBeDefined();
  });

  it("merges provider sidecar entries by evaluatedAt", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecar() as ReplayProviderSidecarV1;
    const evaluatedAt = sidecar.entries[0]!.evaluatedAt;

    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });

    expect(fused.fearGreed).toBeDefined();
    expect(fused.globalMarket).toBeDefined();
    expect(fused.crossVenueTriangulation?.binanceDeltaBps).not.toBeNull();
    expect(fused.crossVenueTriangulation?.bybitDeltaBps).not.toBeNull();
  });

  it("builds from market snapshot helper", () => {
    const fixture = loadFixtureBars();
    const snapshot = buildMarketSnapshot(fixture.bars, fixture.latestQuote, 0, "replay-test");
    const fused = buildReplayFusedContextFromSnapshot(snapshot);
    expect(fused.instrumentId).toBe("BTC/USDT");
    expect(fused.schemaVersion).toBe("waia.trader.fused_context.v2");
  });
});
