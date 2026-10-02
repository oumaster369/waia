import { describe, expect, it } from "vitest";

import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import type { ResearchTrialParametersV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import { evaluateResearchFeatureInvocationV1 } from "@/lib/trader/research/research-feature-invocation-v1";

const PARAMETERS: ResearchTrialParametersV1 = {
  lookbackBars: 3,
  buyZscore: "-1.5",
  sellZscore: "0",
};

function bars(count: number, options: { base?: number; step?: number; symbol?: string; interval?: BarInterval } = {}): Bar[] {
  const base = options.base ?? 100;
  const step = options.step ?? 1;
  const symbol = options.symbol ?? "BTCUSDT";
  const interval = options.interval ?? "1m";
  const intervalMs = interval === "1m" ? 60_000 : interval === "15m" ? 900_000 : 3_600_000;
  const firstOpen = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const barOpenTime = new Date(firstOpen + index * intervalMs).toISOString();
    const barCloseTime = new Date(firstOpen + (index + 1) * intervalMs).toISOString();
    const close = (base + index * step).toFixed(2);
    return {
      symbol,
      interval,
      open: close,
      high: (Number(close) + 1).toFixed(2),
      low: (Number(close) - 1).toFixed(2),
      close,
      volume: "10",
      barOpenTime,
      barCloseTime,
    };
  });
}

function invoke(inputBars: readonly Bar[], index: number, sourceBarIndex = index) {
  return evaluateResearchFeatureInvocationV1({
    parameters: PARAMETERS,
    bars: inputBars,
    symbol: "BTCUSDT",
    interval: "1m",
    index,
    sourceBarIndex,
    cycleId: `cycle-${sourceBarIndex}`,
  });
}

describe("research feature invocation receipt", () => {
  it("records a real NONE evaluation at the first local index", () => {
    const input = bars(1);
    const result = invoke(input, 0, 37);

    expect(result.signal.action).toBe("NONE");
    expect(result.signal.reason).toBe("INSUFFICIENT_BARS");
    expect(result.invocationReceipt).toMatchObject({
      schemaVersion: "waia.research.feature-invocation.v1",
      rule: "trailing-128-closed-bars/v1",
      index: 0,
      sourceBarIndex: 37,
      cycleId: "cycle-37",
      symbol: "BTCUSDT",
      interval: "1m",
      evaluatedAt: input[0]?.barCloseTime,
      firstBarOpenTime: input[0]?.barOpenTime,
      lastBarCloseTime: input[0]?.barCloseTime,
      barCount: 1,
      signal: result.signal,
    });
    expect(result.invocationReceipt.contentDigestHex).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the exact trailing window and distinguishes local from source index", () => {
    const input = bars(130);
    const result = invoke(input, 129, 10_129);

    expect(result.invocationReceipt).toMatchObject({
      index: 129,
      sourceBarIndex: 10_129,
      cycleId: "cycle-10129",
      firstBarOpenTime: input[2]?.barOpenTime,
      lastBarCloseTime: input[129]?.barCloseTime,
      evaluatedAt: input[129]?.barCloseTime,
      barCount: 128,
    });
    expect(result.invocationReceipt.barsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.invocationReceipt.parametersSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps an earlier receipt unchanged when future bars are appended or changed", () => {
    const prefix = bars(5);
    const priorLast = prefix[4]!;
    const futureOpenMs = Date.parse(priorLast.barCloseTime);
    const futureClose = (Number(priorLast.close) + 9_000).toFixed(2);
    const future = {
      ...priorLast,
      open: futureClose,
      high: (Number(futureClose) + 1).toFixed(2),
      low: (Number(futureClose) - 1).toFixed(2),
      close: futureClose,
      barOpenTime: new Date(futureOpenMs).toISOString(),
      barCloseTime: new Date(futureOpenMs + 60_000).toISOString(),
    };
    const withFuture = [...prefix, future];
    const beforeFuture = invoke(prefix, 4, 204);
    const withFutureAtSameCutoff = invoke(withFuture, 4, 204);

    expect(withFutureAtSameCutoff.signal).toEqual(beforeFuture.signal);
    expect(withFutureAtSameCutoff.invocationReceipt).toEqual(beforeFuture.invocationReceipt);

    const next = invoke(withFuture, 5, 205);
    expect(next.invocationReceipt.lastBarCloseTime).toBe(withFuture[5]?.barCloseTime);
    expect(next.invocationReceipt.barsSha256).not.toBe(beforeFuture.invocationReceipt.barsSha256);
  });

  it("changes the receipt when a consumed bar or trial parameters change", () => {
    const input = bars(6);
    const original = invoke(input, 5, 805);
    const changedConsumed = input.map((bar, index) => index === 3
      ? { ...bar, close: "151.00", open: "151.00", high: "152.00", low: "150.00" }
      : bar);
    const changedData = invoke(changedConsumed, 5, 805);
    const changedParameters = evaluateResearchFeatureInvocationV1({
      parameters: { ...PARAMETERS, lookbackBars: 2 },
      bars: input,
      symbol: "BTCUSDT",
      interval: "1m",
      index: 5,
      sourceBarIndex: 805,
      cycleId: "cycle-805",
    });

    expect(changedData.invocationReceipt.barsSha256).not.toBe(original.invocationReceipt.barsSha256);
    expect(changedData.invocationReceipt.contentDigestHex).not.toBe(original.invocationReceipt.contentDigestHex);
    expect(changedParameters.invocationReceipt.parametersSha256)
      .not.toBe(original.invocationReceipt.parametersSha256);
    expect(changedParameters.invocationReceipt.contentDigestHex)
      .not.toBe(original.invocationReceipt.contentDigestHex);
  });

  it.each([-1, 1.5, 2])("rejects invalid local index %s", (index) => {
    expect(() => invoke(bars(2), index)).toThrow();
  });
});
