import { describe, expect, it, vi } from "vitest";

import { synthesizeObservations } from "@/lib/trader/discovery/observation-synthesizer";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { ObservationSynthesizerInput } from "@/lib/trader/discovery/observation.types";

const ORG = "00000000-0000-4000-8000-000000012099";
const BASE = Date.parse("2026-01-01T00:00:00.000Z");

function flatBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "BTC/USDT",
    interval: "1m",
    open: "100",
    high: "100",
    low: "100",
    close: "100",
    volume: "1",
    barOpenTime: new Date(BASE + index * 60_000).toISOString(),
    barCloseTime: new Date(BASE + (index + 1) * 60_000).toISOString(),
  }));
}

function inputFor(
  bars: readonly Bar[],
  executedAt = new Date(BASE + 20 * 60_000),
): ObservationSynthesizerInput {
  return {
    campaignRef: { campaignId: "campaign-1209", campaignDigest: "a".repeat(64), state: "ACTIVE" },
    context: { organizationId: ORG },
    barWindow: {
      symbol: "BTC/USDT",
      start: new Date(BASE).toISOString(),
      end: bars.at(-1)?.barCloseTime ?? new Date(BASE).toISOString(),
    },
    bars,
    closedTrades: [{
      fillId: "fill-asof-1",
      orderId: "order-asof-1",
      symbol: "BTC/USDT",
      executedAt,
      quantity: "1",
      price: "100",
      tradePnl: "-0.01",
    }],
  };
}

describe("descriptive observation synthesis as-of context", () => {
  it("keeps an earlier trade regime when later bars are appended inside the declared observation window", () => {
    const prefix = flatBars(20);
    const extended = flatBars(40);
    const baseline = synthesizeObservations(inputFor(prefix), "observation-asof");
    const withLaterBars = synthesizeObservations(inputFor(extended), "observation-asof");

    expect(baseline.tradeRefs).toHaveLength(1);
    expect(baseline.tradeRefs[0]?.regimeLabel).toBe("CHOP");
    expect(withLaterBars.tradeRefs[0]?.regimeLabel).toBe(baseline.tradeRefs[0]?.regimeLabel);
    expect(baseline.contentDigest).toBe("8b619bec2cea8970bad2ba1dc20bdf9dd10fe29b8bcb729160bd6b52a97875fb");
  });

  it("gives a custom resolver only bars closed by the trade timestamp, including an equal-time close", () => {
    const bars = flatBars(40);
    const resolver = vi.fn((
      _trade: ObservationSynthesizerInput["closedTrades"][number],
      causalBars: readonly Bar[],
    ) => {
      expect(causalBars.at(-1)?.barCloseTime).toBe(new Date(BASE + 20 * 60_000).toISOString());
      return `prefix-${causalBars.length}`;
    });

    const result = synthesizeObservations({ ...inputFor(bars), resolveRegimeForTrade: resolver }, "observation-prefix");

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]?.[1]).toHaveLength(20);
    expect(result.tradeRefs[0]?.regimeLabel).toBe("prefix-20");
  });

  it("retains losing trades with null regime when fewer than twenty bars are available", () => {
    const bars = flatBars(19);
    const result = synthesizeObservations(
      inputFor(bars, new Date(BASE + 19 * 60_000)),
      "observation-short-prefix",
    );

    expect(result.tradeRefs).toEqual([{
      fillId: "fill-asof-1",
      symbol: "BTC/USDT",
      executedAt: new Date(BASE + 19 * 60_000).toISOString(),
      regimeLabel: null,
    }]);
  });

  it("accepts explicit ISO offsets without changing the represented instants", () => {
    const input = inputFor(flatBars(20));
    input.barWindow.start = "2026-01-01T02:00:00.000+02:00";
    input.barWindow.end = "2026-01-01T02:20:00.000+02:00";

    const result = synthesizeObservations(input, "observation-offset");

    expect(result.tradeRefs[0]?.regimeLabel).toBe("CHOP");
  });

  it.each([
    ["malformed start", (input: ObservationSynthesizerInput) => { input.barWindow.start = "not-a-time"; }],
    ["reversed window", (input: ObservationSynthesizerInput) => {
      input.barWindow.start = new Date(BASE + 1).toISOString();
      input.barWindow.end = new Date(BASE).toISOString();
    }],
    ["mixed symbol", (input: ObservationSynthesizerInput) => { input.bars[4]!.symbol = "ETH/USDT"; }],
    ["mixed interval", (input: ObservationSynthesizerInput) => { input.bars[4]!.interval = "5m" as Bar["interval"]; }],
    ["malformed bar time", (input: ObservationSynthesizerInput) => { input.bars[4]!.barCloseTime = "bad"; }],
    ["impossible calendar date", (input: ObservationSynthesizerInput) => {
      input.bars[4]!.barCloseTime = "2026-02-30T00:00:00.000Z";
    }],
    ["timezone-less datetime", (input: ObservationSynthesizerInput) => {
      input.barWindow.start = "2026-01-01T00:00:00.000";
    }],
    ["normalized 24-hour time", (input: ObservationSynthesizerInput) => {
      input.barWindow.end = "2026-01-01T24:00:00.000Z";
    }],
    ["bar outside declared window", (input: ObservationSynthesizerInput) => {
      input.bars[0]!.barOpenTime = new Date(BASE - 60_000).toISOString();
    }],
    ["duplicate bar", (input: ObservationSynthesizerInput) => {
      input.bars = input.bars.map((bar, index) => index === 4 ? { ...input.bars[3]! } : bar);
    }],
    ["unordered bars", (input: ObservationSynthesizerInput) => {
      input.bars = input.bars.map((bar, index, all) => index === 3 ? all[4]! : index === 4 ? all[3]! : bar);
    }],
    ["overlapping bars", (input: ObservationSynthesizerInput) => {
      input.bars[4]!.barOpenTime = new Date(BASE + 3 * 60_000 + 1).toISOString();
    }],
    ["foreign trade symbol", (input: ObservationSynthesizerInput) => { input.closedTrades[0]!.symbol = "ETH/USDT"; }],
    ["trade after declared window", (input: ObservationSynthesizerInput) => {
      input.closedTrades[0]!.executedAt = new Date(BASE + 41 * 60_000);
    }],
    ["invalid trade date", (input: ObservationSynthesizerInput) => {
      input.closedTrades[0]!.executedAt = new Date(Number.NaN);
    }],
  ])("refuses %s before invoking the custom resolver", (_name, mutate) => {
    const input = inputFor(flatBars(40));
    mutate(input);
    const resolver = vi.fn(() => "SHOULD_NOT_RUN");
    input.resolveRegimeForTrade = resolver;

    expect(() => synthesizeObservations(input, "observation-invalid"))
      .toThrow(/^DISCOVERY_OBSERVATION_INPUT_INVALID:/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("does not mutate valid caller inputs", () => {
    const input = inputFor(flatBars(40));
    const before = JSON.stringify(input);

    synthesizeObservations(input, "observation-immutable");

    expect(JSON.stringify(input)).toBe(before);
  });
});
