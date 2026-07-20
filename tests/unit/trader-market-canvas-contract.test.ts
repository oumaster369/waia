import { describe, expect, it } from "vitest";

import {
  CANVAS_1M_RING_CAPACITY,
  MARKET_CANVAS_SCHEMA_VERSION,
  CanvasStateError,
} from "@/lib/trader/market-data/canvas/market-canvas.types";
import {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
  selectMarketCanvasView,
} from "@/lib/trader/market-data/canvas/market-canvas";
import {
  canvasStateContentDigest,
  restoreMarketCanvasState,
  serializeMarketCanvasState,
} from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

describe("trader market canvas contract (HTR-WP06)", () => {
  it("creates empty state with null instrumentId", () => {
    const state = createMarketCanvasState();
    expect(state.schemaVersion).toBe(MARKET_CANVAS_SCHEMA_VERSION);
    expect(state.instrumentId).toBeNull();
    expect(state.closedBarCount).toBe(0);
    expect(state.lastAppliedBarOpenTimeMs).toBeNull();
    expect(state.oneMinuteRing).toEqual([]);
  });

  it("preserves immutability on advance (new state object)", () => {
    const before = createMarketCanvasState();
    const bar = makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" });
    const result = advanceMarketCanvasClosedBar(before, bar);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).not.toBe(before);
    expect(before.closedBarCount).toBe(0);
    expect(result.state.closedBarCount).toBe(1);
  });

  it("serialize∘restore is identity on canonical form", () => {
    let state = createMarketCanvasState();
    const bar = makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" });
    const advanced = advanceMarketCanvasClosedBar(state, bar);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    state = advanced.state;
    const roundTrip = restoreMarketCanvasState(serializeMarketCanvasState(state));
    expect(roundTrip).toEqual(state);
  });

  it("canvasStateContentDigest is stable for identical state", () => {
    let state = createMarketCanvasState();
    const bar = makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" });
    const advanced = advanceMarketCanvasClosedBar(state, bar);
    if (!advanced.ok) throw new Error("advance failed");
    state = advanced.state;
    const d1 = canvasStateContentDigest(state);
    const d2 = canvasStateContentDigest(
      restoreMarketCanvasState(serializeMarketCanvasState(state)),
    );
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("restore rejects unknown schema version fail-closed", () => {
    expect(() =>
      restoreMarketCanvasState({
        schemaVersion: "unknown.v0" as typeof MARKET_CANVAS_SCHEMA_VERSION,
        instrumentId: null,
        closedBarCount: 0,
        lastAppliedBarOpenTimeMs: null,
        oneMinuteRing: [],
      }),
    ).toThrow(CanvasStateError);
  });

  it("selectMarketCanvasView projects read-only view", () => {
    let state = createMarketCanvasState();
    const bar = makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" });
    const advanced = advanceMarketCanvasClosedBar(state, bar);
    if (!advanced.ok) throw new Error("advance failed");
    state = advanced.state;
    const view = selectMarketCanvasView(state);
    expect(view.instrumentId).toBe("BTC/USDT");
    expect(view.closedBarCount).toBe(1);
    expect(view.recent1m).toHaveLength(1);
  });

  it("restore accepts instrumentId null (pre-bind empty state)", () => {
    const restored = restoreMarketCanvasState({
      schemaVersion: MARKET_CANVAS_SCHEMA_VERSION,
      instrumentId: null,
      closedBarCount: 0,
      lastAppliedBarOpenTimeMs: null,
      oneMinuteRing: [],
    });
    expect(restored.instrumentId).toBeNull();
  });
});
