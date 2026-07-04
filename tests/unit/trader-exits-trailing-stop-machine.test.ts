import { describe, expect, it } from "vitest";

import {
  createInitialTrailingState,
  reduceTrailingState,
} from "@/lib/trader/exits/trailing-stop-machine";

describe("trailing stop machine (M4)", () => {
  const base = createInitialTrailingState({
    entryPrice: "100",
    activationPrice: "103",
    trailingDistanceUsdt: "2",
    evaluatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("arms when bar high reaches activation price", () => {
    const result = reduceTrailingState({
      prior: base,
      barHigh: "104",
      barLow: "101",
      markPrice: "103.5",
      stopLossFloorPrice: "96",
      evaluatedAt: "2026-01-01T00:01:00.000Z",
    });

    expect(result.state.phase).toBe("ARMED");
    expect(result.state.peakPrice).toBe("104");
    expect(result.state.stopPrice).toBe("102");
    expect(result.triggered).toBe(false);
  });

  it("triggers exit when mark crosses trailing stop", () => {
    const armed = reduceTrailingState({
      prior: base,
      barHigh: "110",
      barLow: "105",
      markPrice: "109",
      stopLossFloorPrice: "96",
      evaluatedAt: "2026-01-01T00:01:00.000Z",
    }).state;

    const triggered = reduceTrailingState({
      prior: armed,
      barHigh: "110",
      barLow: "100",
      markPrice: "100",
      stopLossFloorPrice: "96",
      evaluatedAt: "2026-01-01T00:02:00.000Z",
    });

    expect(triggered.triggered).toBe(true);
    expect(triggered.state.stopPrice).toBe("108");
  });

  it("floors trailing stop at initial stop loss", () => {
    const tightBase = createInitialTrailingState({
      entryPrice: "100",
      activationPrice: "100.2",
      trailingDistanceUsdt: "2",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    });

    const armed = reduceTrailingState({
      prior: tightBase,
      barHigh: "100.5",
      barLow: "100",
      markPrice: "100.3",
      stopLossFloorPrice: "99",
      evaluatedAt: "2026-01-01T00:01:00.000Z",
    }).state;

    expect(armed.phase).toBe("ARMED");
    expect(armed.stopPrice).toBe("99");
  });
});
