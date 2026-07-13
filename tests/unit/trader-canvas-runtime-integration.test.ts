import { describe, expect, it } from "vitest";

import {
  applyNewBarsToCanvas,
  buildSubstrateFusedContext,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import {
  getFullHistoryRescanCount,
  resetFullHistoryRescanCount,
} from "@/lib/trader/backtest/replay-runtime-metrics";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { Bar } from "@/lib/trader/intelligence/types";

import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

function buildBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) =>
    makeCanvasBar1m({
      barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
    }),
  );
}

describe("canvas runtime integration (HTR-WP09)", () => {
  it("incremental fused context matches legacy oracle on bounded prefix", () => {
    resetFullHistoryRescanCount();
    const bars = buildBars(120);
    let canvasState = createInitialCanvasState();
    let applied = 0;
    for (let end = 20; end <= bars.length; end += 10) {
      const prefix = bars.slice(0, end);
      const advance = applyNewBarsToCanvas(canvasState, prefix, applied);
      canvasState = advance.state;
      applied += advance.appliedBars;

      const evaluatedAt = prefix.at(-1)!.barCloseTime;
      const quote = {
        symbol: "BTC/USDT",
        bid: prefix.at(-1)!.close,
        ask: prefix.at(-1)!.close,
        last: prefix.at(-1)!.close,
        timestamp: evaluatedAt,
      };

      const incremental = buildSubstrateFusedContext({
        substrateMode: "incremental",
        bars: prefix,
        quote,
        evaluatedAt,
        instrumentId: "BTC/USDT",
        canvasState,
      });
      const legacy = buildSubstrateFusedContext({
        substrateMode: "legacy-oracle",
        bars: prefix,
        quote,
        evaluatedAt,
        instrumentId: "BTC/USDT",
        canvasState,
      });

      expect(canonicalJsonString(incremental)).toBe(canonicalJsonString(legacy));
    }

    expect(getFullHistoryRescanCount()).toBeGreaterThan(0);
    resetFullHistoryRescanCount();
    buildSubstrateFusedContext({
      substrateMode: "incremental",
      bars: bars.slice(0, 40),
      quote: {
        symbol: "BTC/USDT",
        bid: "42050",
        ask: "42050",
        last: "42050",
        timestamp: bars[39]!.barCloseTime,
      },
      evaluatedAt: bars[39]!.barCloseTime,
      instrumentId: "BTC/USDT",
      canvasState,
    });
    expect(getFullHistoryRescanCount()).toBe(0);
  });
});
