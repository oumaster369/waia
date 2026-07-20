import { describe, expect, it } from "vitest";

import {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
} from "@/lib/trader/market-data/canvas/market-canvas";
import type { Bar } from "@/lib/trader/intelligence/types";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

describe("trader market canvas sequence gate (HTR-WP06)", () => {
  const baseTime = Date.UTC(2024, 0, 1, 0, 0);

  function barAtMinute(minute: number, overrides: Partial<Bar> = {}) {
    return makeCanvasBar1m({
      barOpenTime: new Date(baseTime + minute * 60_000).toISOString(),
      ...overrides,
    });
  }

  it("binds instrumentId on first valid bar from null", () => {
    const state = createMarketCanvasState();
    expect(state.instrumentId).toBeNull();
    const result = advanceMarketCanvasClosedBar(state, barAtMinute(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.instrumentId).toBe("BTC/USDT");
  });

  it("CANVAS_INSTRUMENT_MISMATCH fail-closed", () => {
    let state = createMarketCanvasState();
    const first = advanceMarketCanvasClosedBar(state, barAtMinute(0));
    if (!first.ok) throw new Error("setup failed");
    state = first.state;
    const mismatch = advanceMarketCanvasClosedBar(state, barAtMinute(1, { symbol: "ETH/USDT" }));
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error).toBe("CANVAS_INSTRUMENT_MISMATCH");
    expect(mismatch.state).toEqual(state);
  });

  it("CANVAS_1M_INVALID_TIMESTAMP for non-finite barOpenTime", () => {
    const state = createMarketCanvasState();
    const result = advanceMarketCanvasClosedBar(
      state,
      makeCanvasBar1m({ barOpenTime: "not-a-date", barCloseTime: "2024-01-01T00:01:00.000Z" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("CANVAS_1M_INVALID_TIMESTAMP");
    expect(result.state).toEqual(state);
  });

  it("CANVAS_1M_INVALID_TIMESTAMP when barCloseTime <= barOpenTime", () => {
    const state = createMarketCanvasState();
    const result = advanceMarketCanvasClosedBar(
      state,
      makeCanvasBar1m({
        barOpenTime: "2024-01-01T00:01:00.000Z",
        barCloseTime: "2024-01-01T00:00:00.000Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("CANVAS_1M_INVALID_TIMESTAMP");
  });

  it("CANVAS_1M_INVALID_OHLCV for high < low", () => {
    const state = createMarketCanvasState();
    const result = advanceMarketCanvasClosedBar(state, barAtMinute(0, { high: "90", low: "100" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("CANVAS_1M_INVALID_OHLCV");
  });

  it("conflicting duplicate => CANVAS_1M_DUPLICATE_BAR fail-closed", () => {
    let state = createMarketCanvasState();
    const first = advanceMarketCanvasClosedBar(state, barAtMinute(0));
    if (!first.ok) throw new Error("setup failed");
    state = first.state;
    const dup = advanceMarketCanvasClosedBar(state, barAtMinute(0, { close: "999" }));
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toBe("CANVAS_1M_DUPLICATE_BAR");
    expect(dup.state).toEqual(state);
  });

  it("identical duplicate => ok:true, state unchanged, gapObserved:false", () => {
    let state = createMarketCanvasState();
    const bar = barAtMinute(0);
    const first = advanceMarketCanvasClosedBar(state, bar);
    if (!first.ok) throw new Error("setup failed");
    state = first.state;
    const dup = advanceMarketCanvasClosedBar(state, bar);
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    expect(dup.state).toEqual(state);
    expect(dup.gapObserved).toBe(false);
  });

  it("CANVAS_1M_OUT_OF_ORDER fail-closed", () => {
    let state = createMarketCanvasState();
    const first = advanceMarketCanvasClosedBar(state, barAtMinute(2));
    if (!first.ok) throw new Error("setup failed");
    state = first.state;
    const ooo = advanceMarketCanvasClosedBar(state, barAtMinute(1));
    expect(ooo.ok).toBe(false);
    if (ooo.ok) return;
    expect(ooo.error).toBe("CANVAS_1M_OUT_OF_ORDER");
    expect(ooo.state).toEqual(state);
  });

  it("gap => ok:true + gapObserved:true + no synthetic bar", () => {
    let state = createMarketCanvasState();
    const first = advanceMarketCanvasClosedBar(state, barAtMinute(0));
    if (!first.ok) throw new Error("setup failed");
    state = first.state;
    const gap = advanceMarketCanvasClosedBar(state, barAtMinute(3));
    expect(gap.ok).toBe(true);
    if (!gap.ok) return;
    expect(gap.gapObserved).toBe(true);
    expect(gap.state.closedBarCount).toBe(2);
    expect(gap.state.oneMinuteRing).toHaveLength(2);
  });
});
