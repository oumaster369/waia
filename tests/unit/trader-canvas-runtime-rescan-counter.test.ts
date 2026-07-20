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
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

describe("canvas runtime rescan counter (HTR-WP09)", () => {
  it("incremental path records zero full-history rescans", () => {
    resetFullHistoryRescanCount();
    const bars = Array.from({ length: 50 }, (_, index) =>
      makeCanvasBar1m({
        barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
      }),
    );
    let canvasState = createInitialCanvasState();
    let applied = 0;
    for (let end = 20; end <= bars.length; end += 5) {
      const prefix = bars.slice(0, end);
      const advance = applyNewBarsToCanvas(canvasState, prefix, applied);
      canvasState = advance.state;
      applied += advance.appliedBars;
      const evaluatedAt = prefix.at(-1)!.barCloseTime;
      buildSubstrateFusedContext({
        substrateMode: "incremental",
        bars: prefix,
        quote: {
          symbol: "BTC/USDT",
          bid: prefix.at(-1)!.close,
          ask: prefix.at(-1)!.close,
          last: prefix.at(-1)!.close,
          timestamp: evaluatedAt,
        },
        evaluatedAt,
        instrumentId: "BTC/USDT",
        canvasState,
      });
    }
    expect(getFullHistoryRescanCount()).toBe(0);
  });

  it("legacy-oracle path increments rescan counter", () => {
    resetFullHistoryRescanCount();
    const bars = Array.from({ length: 30 }, (_, index) =>
      makeCanvasBar1m({
        barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
      }),
    );
    buildSubstrateFusedContext({
      substrateMode: "legacy-oracle",
      bars,
      quote: {
        symbol: "BTC/USDT",
        bid: bars.at(-1)!.close,
        ask: bars.at(-1)!.close,
        last: bars.at(-1)!.close,
        timestamp: bars.at(-1)!.barCloseTime,
      },
      evaluatedAt: bars.at(-1)!.barCloseTime,
      instrumentId: "BTC/USDT",
      canvasState: createInitialCanvasState(),
    });
    expect(getFullHistoryRescanCount()).toBeGreaterThan(0);
  });
});
