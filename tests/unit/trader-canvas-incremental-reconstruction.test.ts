import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
  serializeMarketCanvasState,
  restoreMarketCanvasState,
} from "@/lib/trader/market-data/canvas";
import { buildReconstructionSnapshotForClosedPrefix } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { measureReconstructionStateBounds } from "@/lib/trader/market-data/canvas/incremental-reconstruction";
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

describe("trader canvas incremental reconstruction", () => {
  it("matches oracle contentDigest at HTF-close boundaries", () => {
    const bars = sampleBars(180);
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
        expect(state.reconstruction.snapshot.contentDigest).toBe(oracle.contentDigest);
        prevCloseCount = closeCount;
      }
    }
    expect(prevCloseCount).toBeGreaterThan(0);
  });

  it("keeps bounded reconstruction state within declared caps", () => {
    const bars = sampleBars(120);
    let state = createMarketCanvasState();
    for (const bar of bars) {
      const result = advanceMarketCanvasClosedBar(state, bar);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      state = result.state;
      if (state.reconstruction) {
        const bounds = measureReconstructionStateBounds(state.reconstruction);
        expect(bounds.RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS).toBe(true);
      }
    }
  });

  it("restores deterministic reconstruction snapshot after serialize round-trip", () => {
    const bars = sampleBars(90);
    let state = createMarketCanvasState();
    for (const bar of bars) {
      const result = advanceMarketCanvasClosedBar(state, bar);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      state = result.state;
    }
    const before = state.reconstruction?.snapshot?.contentDigest;
    const restored = restoreMarketCanvasState(serializeMarketCanvasState(state));
    expect(restored.reconstruction?.snapshot?.contentDigest).toBe(before);
  });
});
