import { describe, expect, it } from "vitest";

import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { evaluateResearchLookbackV1 } from "@/lib/trader/research/research-lookback-evaluator-v1";

const HOUR_MS = 3_600_000;
const START_MS = Date.parse("2026-01-01T00:00:00.000Z");
const PARAMETERS = { lookbackBars: 4, buyZscore: "-1.5", sellZscore: "0" } as const;

function barsFromCloses(
  closes: readonly string[],
  options: { interval?: BarInterval; symbol?: string; startMs?: number; closeOffsetMs?: number } = {},
): Bar[] {
  const interval = options.interval ?? "1h";
  const intervalMs = interval === "1h" ? HOUR_MS : 60_000;
  const symbol = options.symbol ?? "BTCUSDT";
  const startMs = options.startMs ?? START_MS;
  const closeOffsetMs = options.closeOffsetMs ?? intervalMs;
  return closes.map((close, index) => {
    const openMs = startMs + index * intervalMs;
    return {
      symbol,
      interval,
      open: close,
      high: close,
      low: close,
      close,
      volume: "1",
      barOpenTime: new Date(openMs).toISOString(),
      barCloseTime: new Date(openMs + closeOffsetMs).toISOString(),
    };
  });
}

function evaluate(
  closes: readonly string[],
  overrides: Partial<Parameters<typeof evaluateResearchLookbackV1>[0]> = {},
) {
  const bars = overrides.bars ?? barsFromCloses(closes);
  return evaluateResearchLookbackV1({
    parameters: PARAMETERS,
    bars,
    symbol: "BTCUSDT",
    interval: "1h",
    evaluatedAt: bars.at(-1)?.barCloseTime ?? new Date(START_MS).toISOString(),
    ...overrides,
  });
}

describe("evaluateResearchLookbackV1", () => {
  it("matches the independent four-close population-zscore oracle at eight decimals", () => {
    // Closed form: mean = 97.5; population variance = 18.75;
    // sqrt(18.75) truncates to 4.33012701 at 8dp; dividing by that fixed-point
    // dispersion truncates the reported z-score to -1.73205081.
    const result = evaluate(["100", "100", "100", "90"]);

    expect(result).toMatchObject({
      authority: "SIGNAL_ONLY",
      action: "BUY",
      reason: "BUY_THRESHOLD",
      close: "90",
      meanClose: "97.5",
      populationDispersion: "4.33012701",
      zscore: "-1.73205081",
      parameters: PARAMETERS,
    });
  });

  it("changes the research descriptor when the selected lookback changes", () => {
    const bars = barsFromCloses(["100", "100", "100", "90"]);
    const short = evaluateResearchLookbackV1({
      parameters: { ...PARAMETERS, lookbackBars: 2 },
      bars,
      symbol: "BTCUSDT",
      interval: "1h",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    });
    const long = evaluateResearchLookbackV1({
      parameters: PARAMETERS,
      bars,
      symbol: "BTCUSDT",
      interval: "1h",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    });

    expect(short).toMatchObject({ action: "NONE", reason: "NEUTRAL", zscore: "-1" });
    expect(long).toMatchObject({ action: "BUY", reason: "BUY_THRESHOLD", zscore: "-1.73205081" });
    expect(short.parameters.lookbackBars).toBe(2);
    expect(long.parameters.lookbackBars).toBe(4);
  });

  it("emits SELL for a recent higher close, but no proposal for short or flat inputs", () => {
    expect(evaluate(["100", "100", "100", "110"])).toMatchObject({
      action: "SELL",
      reason: "SELL_THRESHOLD",
      zscore: "1.73205081",
    });

    expect(evaluate(["100", "100", "100"], {
      parameters: { ...PARAMETERS, lookbackBars: 4 },
    })).toMatchObject({ action: "NONE", reason: "INSUFFICIENT_BARS", close: "100", zscore: null });
    expect(evaluate(["100", "100", "100", "100"])).toMatchObject({
      action: "NONE",
      reason: "ZERO_DISPERSION",
      meanClose: "100",
      populationDispersion: "0",
      zscore: null,
    });
  });

  it("keeps a tiny negative exact z-score neutral even when its display rounds to zero", () => {
    const result = evaluate(["1", "1000000000", "1", "333333333.99999998"]);

    expect(result).toMatchObject({ action: "NONE", reason: "NEUTRAL", zscore: "0" });
  });

  it("returns detached frozen parameter and result values", () => {
    const parameters: { lookbackBars: number; buyZscore: "-1.5"; sellZscore: "0" } = {
      ...PARAMETERS,
    };
    const bars = barsFromCloses(["100", "100", "100", "90"]);
    const result = evaluateResearchLookbackV1({
      parameters,
      bars,
      symbol: "BTCUSDT",
      interval: "1h",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    });

    parameters.lookbackBars = 2;
    bars[3]!.close = "200";

    expect(result.action).toBe("BUY");
    expect(result.parameters.lookbackBars).toBe(4);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.parameters)).toBe(true);
  });

  it("rejects unknown parameter fields", () => {
    expect(() => evaluateResearchLookbackV1({
      parameters: { ...PARAMETERS, arbitrary: "1" },
      bars: barsFromCloses(["100", "100", "100", "90"]),
      symbol: "BTCUSDT",
      interval: "1h",
      evaluatedAt: new Date(START_MS + 4 * HOUR_MS).toISOString(),
    })).toThrow();
  });

  it("rejects a wrong symbol or bar interval", () => {
    const bars = barsFromCloses(["100", "100", "100", "90"]);
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS, bars, symbol: "ETHUSDT", interval: "1h",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    })).toThrow("RESEARCH_EXECUTABLE_INSTRUMENT_MISMATCH");
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS, bars, symbol: "BTCUSDT", interval: "15m",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    })).toThrow("RESEARCH_EXECUTABLE_INSTRUMENT_MISMATCH");
  });

  it.each([
    ["unordered bars", (source: Bar[]) => [source[0]!, source[2]!, source[1]!, source[3]!]],
    ["duplicate bar time", (source: Bar[]) => [source[0]!, source[1]!, { ...source[1]! }, source[3]!]],
    ["gapped bars", (source: Bar[]) => [source[0]!, source[1]!, source[3]!]],
  ])("rejects %s", (_label, transform) => {
    const bars = transform(barsFromCloses(["100", "101", "99", "90"]));
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS,
      bars,
      symbol: "BTCUSDT",
      interval: "1h",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    })).toThrow("RESEARCH_EXECUTABLE_NONCAUSAL_OR_GAPPED_PREFIX");
  });

  it("accepts a closed bar ending at the interval boundary, or one millisecond before it", () => {
    for (const closeOffsetMs of [HOUR_MS, HOUR_MS - 1]) {
      const bars = barsFromCloses(["100", "100", "100", "90"], { closeOffsetMs });
      expect(evaluateResearchLookbackV1({
        parameters: PARAMETERS,
        bars,
        symbol: "BTCUSDT",
        interval: "1h",
        evaluatedAt: bars.at(-1)!.barCloseTime,
      }).action).toBe("BUY");
    }
  });

  it("rejects future and malformed timestamps", () => {
    const bars = barsFromCloses(["100", "100", "100", "90"]);
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS, bars, symbol: "BTCUSDT", interval: "1h",
      evaluatedAt: new Date(Date.parse(bars.at(-1)!.barCloseTime) - 1).toISOString(),
    })).toThrow("RESEARCH_EXECUTABLE_NONCAUSAL_OR_GAPPED_PREFIX");
    const malformed = bars.map(bar => ({ ...bar }));
    malformed[2]!.barCloseTime = "not-a-time";
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS, bars: malformed, symbol: "BTCUSDT", interval: "1h",
      evaluatedAt: malformed.at(-1)!.barCloseTime,
    })).toThrow("RESEARCH_EXECUTABLE_NONCAUSAL_OR_GAPPED_PREFIX");
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS, bars, symbol: "BTCUSDT", interval: "1h", evaluatedAt: "bad-time",
    })).toThrow("RESEARCH_EXECUTABLE_TIME_INVALID");
  });

  it.each([
    ["evaluatedAt", (bars: Bar[]) => ({ bars, evaluatedAt: "2026-01-01T04:00:00" })],
    ["barOpenTime", (bars: Bar[]) => {
      const next = bars.map(bar => ({ ...bar }));
      next[0]!.barOpenTime = "2026-01-01T00:00:00";
      return { bars: next, evaluatedAt: next.at(-1)!.barCloseTime };
    }],
    ["barCloseTime", (bars: Bar[]) => {
      const next = bars.map(bar => ({ ...bar }));
      next[0]!.barCloseTime = "2026-01-01T01:00:00";
      return { bars: next, evaluatedAt: next.at(-1)!.barCloseTime };
    }],
    ["normalized calendar date", (bars: Bar[]) => ({ bars, evaluatedAt: "2026-02-30T04:00:00.000Z" })],
  ])("rejects a zone-less or invalid %s timestamp", (_label, makeCase) => {
    const candidate = makeCase(barsFromCloses(["100", "100", "100", "90"]));
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS,
      bars: candidate.bars,
      symbol: "BTCUSDT",
      interval: "1h",
      evaluatedAt: candidate.evaluatedAt,
    })).toThrow();
  });

  it.each(["0", "-1", "1e2", "1.123456789", "x" ])("rejects invalid close price %s", (close) => {
    const bars = barsFromCloses(["100", "100", "100", close]);
    expect(() => evaluateResearchLookbackV1({
      parameters: PARAMETERS, bars, symbol: "BTCUSDT", interval: "1h",
      evaluatedAt: bars.at(-1)!.barCloseTime,
    })).toThrow("RESEARCH_EXECUTABLE_PRICE_INVALID");
  });
});
