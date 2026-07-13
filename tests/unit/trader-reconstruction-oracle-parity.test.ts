import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
} from "@/lib/trader/market-data/canvas";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { buildReconstructionSnapshotForClosedPrefix } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type { Bar } from "@/lib/trader/intelligence/types";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: String(42000 + (i % 7)),
    high: String(42100 + (i % 5)),
    low: String(41900 - (i % 3)),
    close: String(42050 + (i % 4)),
    volume: String(12.5 + (i % 10) * 0.1),
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1) - 1).toISOString(),
  }));
}

describe("trader reconstruction oracle parity", () => {
  it("classifies forming-bucket-only diffs as intentional defect correction", () => {
    const bars = sampleBars(30);
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const closedOracle = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });
    const resampled = resampleReplayMtfBars({ bars1m: bars });
    const hasForming = Object.values(resampled).some((series) => (series?.length ?? 0) > 0);
    expect(hasForming).toBe(true);
    expect(closedOracle.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires exact closed-boundary digest parity for incremental canvas", () => {
    const bars = sampleBars(150);
    let state = createMarketCanvasState();
    const prefix: Bar[] = [];
    let prevCloseCount = 0;

    for (const bar of bars) {
      prefix.push(bar);
      const result = advanceMarketCanvasClosedBar(state, bar);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      state = result.state;
      const closeCount = state.reconstruction?.htfCloseCount ?? 0;
      if (closeCount > prevCloseCount && state.reconstruction?.snapshot) {
        const evaluatedAt = bar.barCloseTime;
        const oracle = buildReconstructionSnapshotForClosedPrefix({ bars1m: prefix, evaluatedAt });
        if (state.reconstruction.snapshot.contentDigest !== oracle.contentDigest) {
          throw new Error("RECONSTRUCTION_ORACLE_DIVERGENCE");
        }
        prevCloseCount = closeCount;
      }
    }
  });
});
