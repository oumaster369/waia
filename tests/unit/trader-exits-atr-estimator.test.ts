import { describe, expect, it } from "vitest";

import { computeAtrUsdt, filterBarsForLot } from "@/lib/trader/exits/atr-estimator";
import type { Bar } from "@/lib/trader/intelligence/types";

function makeBar(overrides: Partial<Bar> & Pick<Bar, "barCloseTime" | "close">): Bar {
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: overrides.open ?? overrides.close,
    high: overrides.high ?? overrides.close,
    low: overrides.low ?? overrides.close,
    volume: "1",
    barOpenTime: overrides.barOpenTime ?? overrides.barCloseTime,
    ...overrides,
  };
}

describe("computeAtrUsdt (M4)", () => {
  it("returns byte-identical ATR on fixed fixture", () => {
    const bars: Bar[] = [];
    let price = 100;
    for (let index = 0; index < 20; index += 1) {
      const close = String(price);
      const high = String(price + 1);
      const low = String(price - 1);
      bars.push(
        makeBar({
          barCloseTime: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
          open: close,
          high,
          low,
          close,
        }),
      );
      price += index % 2 === 0 ? 1 : -0.5;
    }

    const first = computeAtrUsdt(bars, 14);
    const second = computeAtrUsdt(bars, 14);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
  });

  it("returns null when insufficient bars", () => {
    const bars = [makeBar({ barCloseTime: "2026-01-01T00:00:00.000Z", close: "100" })];
    expect(computeAtrUsdt(bars, 14)).toBeNull();
  });

  it("returns null on invalid OHLC", () => {
    const bars = Array.from({ length: 14 }, (_, index) =>
      makeBar({
        barCloseTime: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        close: "100",
        high: "99",
        low: "101",
      }),
    );
    expect(computeAtrUsdt(bars, 14)).toBeNull();
  });

  it("returns null for non-positive period (fail-closed)", () => {
    const bars = Array.from({ length: 14 }, (_, index) =>
      makeBar({
        barCloseTime: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        close: "100",
        high: "101",
        low: "99",
      }),
    );
    expect(computeAtrUsdt(bars, 0)).toBeNull();
    expect(computeAtrUsdt(bars, -5)).toBeNull();
  });

  it("dedups duplicate (symbol, barCloseTime) bars so ATR is not double-counted", () => {
    const base = Array.from({ length: 14 }, (_, index) =>
      makeBar({
        barCloseTime: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        close: String(100 + index),
        high: String(100 + index + 1),
        low: String(100 + index - 1),
      }),
    );
    // Inject an exact duplicate of the last bar (same symbol + barCloseTime).
    const withDup = [...base, base[base.length - 1]!];
    expect(computeAtrUsdt(withDup, 14)).toBe(computeAtrUsdt(base, 14));
  });

  it("returns null when flat market yields zero ATR", () => {
    const bars = Array.from({ length: 14 }, (_, index) =>
      makeBar({
        barCloseTime: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
        close: "100",
        high: "100",
        low: "100",
        open: "100",
      }),
    );
    expect(computeAtrUsdt(bars, 14)).toBeNull();
  });
});

describe("filterBarsForLot (M4)", () => {
  it("filters by symbol and open/evaluated window", () => {
    const openedAt = new Date("2026-01-01T00:05:00.000Z");
    const bars = [
      makeBar({ barCloseTime: "2026-01-01T00:04:00.000Z", close: "1" }),
      makeBar({ barCloseTime: "2026-01-01T00:05:00.000Z", close: "2" }),
      makeBar({ barCloseTime: "2026-01-01T00:06:00.000Z", close: "3", symbol: "ETH/USDT" }),
      makeBar({ barCloseTime: "2026-01-01T00:07:00.000Z", close: "4" }),
    ];
    const filtered = filterBarsForLot(bars, "BTC/USDT", openedAt, "2026-01-01T00:06:00.000Z");
    expect(filtered.map((bar) => bar.close)).toEqual(["2"]);
  });
});
