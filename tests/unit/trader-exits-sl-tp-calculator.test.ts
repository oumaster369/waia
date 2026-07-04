import { describe, expect, it } from "vitest";

import { DEFAULT_EXIT_RUN_CONFIG } from "@/lib/trader/exits/exit-types";
import { computeSlTpLevels } from "@/lib/trader/exits/sl-tp-calculator";

describe("computeSlTpLevels (M4)", () => {
  it("computes deterministic SL/TP from entry + ATR", () => {
    const result = computeSlTpLevels({
      entryPrice: "100",
      atrUsdt: "2",
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      computedAt: "2026-01-01T00:14:00.000Z",
    });

    expect(result.stopLoss.price).toBe("96");
    expect(result.takeProfit.price).toBe("106");
    expect(result.activationPrice).toBe("103");
    expect(result.trailingDistanceUsdt).toBe("2");
  });

  it("is byte-identical on replay", () => {
    const input = {
      entryPrice: "42000.5",
      atrUsdt: "125.25",
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      computedAt: "2026-01-01T00:14:00.000Z",
    };
    expect(computeSlTpLevels(input)).toEqual(computeSlTpLevels(input));
  });

  it("maintains SL < entry < TP ordering invariant", () => {
    const result = computeSlTpLevels({
      entryPrice: "100",
      atrUsdt: "2",
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      computedAt: "2026-01-01T00:14:00.000Z",
    });
    expect(Number(result.stopLoss.price)).toBeLessThan(100);
    expect(Number(result.takeProfit.price)).toBeGreaterThan(100);
  });

  it("throws on non-positive entry price (fail-closed)", () => {
    expect(() =>
      computeSlTpLevels({
        entryPrice: "0",
        atrUsdt: "2",
        runConfig: DEFAULT_EXIT_RUN_CONFIG,
        computedAt: "2026-01-01T00:14:00.000Z",
      }),
    ).toThrow();
  });

  it("throws on non-positive ATR (fail-closed)", () => {
    expect(() =>
      computeSlTpLevels({
        entryPrice: "100",
        atrUsdt: "0",
        runConfig: DEFAULT_EXIT_RUN_CONFIG,
        computedAt: "2026-01-01T00:14:00.000Z",
      }),
    ).toThrow();
  });

  it("throws on invalid multiples (fail-closed)", () => {
    expect(() =>
      computeSlTpLevels({
        entryPrice: "100",
        atrUsdt: "2",
        runConfig: { ...DEFAULT_EXIT_RUN_CONFIG, stopLossAtrMultiple: "0" },
        computedAt: "2026-01-01T00:14:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      computeSlTpLevels({
        entryPrice: "100",
        atrUsdt: "2",
        runConfig: { ...DEFAULT_EXIT_RUN_CONFIG, trailingDistanceAtrMultiple: "0" },
        computedAt: "2026-01-01T00:14:00.000Z",
      }),
    ).toThrow();
  });

  it("throws when SL multiple would push stop below zero (fail-closed)", () => {
    expect(() =>
      computeSlTpLevels({
        entryPrice: "100",
        atrUsdt: "60",
        runConfig: { ...DEFAULT_EXIT_RUN_CONFIG, stopLossAtrMultiple: "2" },
        computedAt: "2026-01-01T00:14:00.000Z",
      }),
    ).toThrow();
  });
});
