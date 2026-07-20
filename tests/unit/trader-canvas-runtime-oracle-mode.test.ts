import { describe, expect, it } from "vitest";

import {
  buildSubstrateFusedContext,
  createInitialCanvasState,
  applyNewBarsToCanvas,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { DEFAULT_REPLAY_SUBSTRATE_MODE } from "@/lib/trader/backtest/replay-substrate-mode";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

describe("canvas runtime oracle mode (HTR-WP09)", () => {
  it("defaults to incremental substrate mode", () => {
    expect(DEFAULT_REPLAY_SUBSTRATE_MODE).toBe("incremental");
  });

  it("legacy-oracle mode builds fused context without canvas parity throw", () => {
    const bars = Array.from({ length: 40 }, (_, index) =>
      makeCanvasBar1m({
        barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
      }),
    );
    let canvasState = createInitialCanvasState();
    const advance = applyNewBarsToCanvas(canvasState, bars, 0);
    canvasState = advance.state;
    const evaluatedAt = bars.at(-1)!.barCloseTime;

    const fused = buildSubstrateFusedContext({
      substrateMode: "legacy-oracle",
      bars,
      quote: {
        symbol: "BTC/USDT",
        bid: bars.at(-1)!.close,
        ask: bars.at(-1)!.close,
        last: bars.at(-1)!.close,
        timestamp: evaluatedAt,
      },
      evaluatedAt,
      instrumentId: "BTC/USDT",
      canvasState,
    });

    expect(fused.mtfBars["1m"]).toBeDefined();
    expect(fused.schemaVersion).toBe("waia.trader.fused_context.v2");
  });
});
