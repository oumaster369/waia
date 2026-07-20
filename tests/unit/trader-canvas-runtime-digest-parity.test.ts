import { describe, expect, it } from "vitest";

import {
  applyNewBarsToCanvas,
  buildSubstrateFusedContext,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

describe("canvas runtime digest parity (HTR-WP09)", () => {
  it("parity-both mode accepts exact semantic match", () => {
    const bars = Array.from({ length: 60 }, (_, index) =>
      makeCanvasBar1m({
        barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
      }),
    );
    let canvasState = createInitialCanvasState();
    const advance = applyNewBarsToCanvas(canvasState, bars, 0);
    canvasState = advance.state;
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const quote = {
      symbol: "BTC/USDT",
      bid: bars.at(-1)!.close,
      ask: bars.at(-1)!.close,
      last: bars.at(-1)!.close,
      timestamp: evaluatedAt,
    };

    const fused = buildSubstrateFusedContext({
      substrateMode: "parity-both",
      bars,
      quote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      canvasState,
    });

    const incremental = buildSubstrateFusedContext({
      substrateMode: "incremental",
      bars,
      quote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      canvasState,
    });

    expect(canonicalJsonString(fused)).toBe(canonicalJsonString(incremental));
  });
});
