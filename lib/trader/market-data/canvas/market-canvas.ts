import { compareDecimal } from "@/lib/trader/risk/numeric";

import {
  CANVAS_1M_RING_CAPACITY,
  MARKET_CANVAS_SCHEMA_VERSION,
  type CanvasAdvanceError,
  type CanvasAdvanceResult,
  type CanvasClosedBar,
  type MarketCanvasState,
  type MarketCanvasView,
} from "@/lib/trader/market-data/canvas/market-canvas.types";

const ONE_MINUTE_MS = 60_000;

export function createMarketCanvasState(): MarketCanvasState {
  return {
    schemaVersion: MARKET_CANVAS_SCHEMA_VERSION,
    instrumentId: null,
    closedBarCount: 0,
    lastAppliedBarOpenTimeMs: null,
    oneMinuteRing: [],
  };
}

function barsAreIdentical(a: CanvasClosedBar, b: CanvasClosedBar): boolean {
  return (
    a.symbol === b.symbol &&
    a.interval === b.interval &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume &&
    a.barOpenTime === b.barOpenTime &&
    a.barCloseTime === b.barCloseTime
  );
}

function lastAppliedBar(state: MarketCanvasState): CanvasClosedBar | null {
  if (state.oneMinuteRing.length === 0) {
    return null;
  }
  return state.oneMinuteRing[state.oneMinuteRing.length - 1] ?? null;
}

function failClosed(state: MarketCanvasState, error: CanvasAdvanceError): CanvasAdvanceResult {
  return { ok: false, error, state };
}

function validateTimestamps(bar: CanvasClosedBar): CanvasAdvanceError | null {
  const barOpenTimeMs = Date.parse(bar.barOpenTime);
  const barCloseTimeMs = Date.parse(bar.barCloseTime);
  if (!Number.isFinite(barOpenTimeMs) || !Number.isFinite(barCloseTimeMs)) {
    return "CANVAS_1M_INVALID_TIMESTAMP";
  }
  if (barCloseTimeMs <= barOpenTimeMs) {
    return "CANVAS_1M_INVALID_TIMESTAMP";
  }
  return null;
}

function validateOhlcv(bar: CanvasClosedBar): CanvasAdvanceError | null {
  const fields = [bar.open, bar.high, bar.low, bar.close, bar.volume];
  for (const field of fields) {
    if (field === undefined || field === null || field === "") {
      return "CANVAS_1M_INVALID_OHLCV";
    }
    const numeric = Number(field);
    if (!Number.isFinite(numeric)) {
      return "CANVAS_1M_INVALID_OHLCV";
    }
  }
  try {
    if (
      compareDecimal(bar.high, bar.low) < 0 ||
      compareDecimal(bar.open, "0") <= 0 ||
      compareDecimal(bar.close, "0") <= 0 ||
      compareDecimal(bar.high, "0") <= 0 ||
      compareDecimal(bar.low, "0") <= 0
    ) {
      return "CANVAS_1M_INVALID_OHLCV";
    }
  } catch {
    return "CANVAS_1M_INVALID_OHLCV";
  }
  return null;
}

function detectGap(lastAppliedBarOpenTimeMs: number, barOpenTimeMs: number): boolean {
  return barOpenTimeMs - lastAppliedBarOpenTimeMs > ONE_MINUTE_MS;
}

function appendToRing(
  ring: readonly CanvasClosedBar[],
  bar: CanvasClosedBar,
): readonly CanvasClosedBar[] {
  const next = [...ring, bar];
  if (next.length <= CANVAS_1M_RING_CAPACITY) {
    return next;
  }
  return next.slice(next.length - CANVAS_1M_RING_CAPACITY);
}

export function advanceMarketCanvasClosedBar(
  state: MarketCanvasState,
  bar1m: CanvasClosedBar,
): CanvasAdvanceResult {
  if (state.instrumentId !== null && bar1m.symbol !== state.instrumentId) {
    return failClosed(state, "CANVAS_INSTRUMENT_MISMATCH");
  }

  const timestampError = validateTimestamps(bar1m);
  if (timestampError) {
    return failClosed(state, timestampError);
  }

  const ohlcvError = validateOhlcv(bar1m);
  if (ohlcvError) {
    return failClosed(state, ohlcvError);
  }

  const barOpenTimeMs = Date.parse(bar1m.barOpenTime);
  const previous = lastAppliedBar(state);

  if (previous !== null && previous.barOpenTime === bar1m.barOpenTime) {
    if (barsAreIdentical(previous, bar1m)) {
      return { ok: true, state, gapObserved: false };
    }
    return failClosed(state, "CANVAS_1M_DUPLICATE_BAR");
  }

  if (state.lastAppliedBarOpenTimeMs !== null && barOpenTimeMs <= state.lastAppliedBarOpenTimeMs) {
    return failClosed(state, "CANVAS_1M_OUT_OF_ORDER");
  }

  const gapObserved =
    state.lastAppliedBarOpenTimeMs !== null &&
    detectGap(state.lastAppliedBarOpenTimeMs, barOpenTimeMs);

  const nextState: MarketCanvasState = {
    schemaVersion: MARKET_CANVAS_SCHEMA_VERSION,
    instrumentId: state.instrumentId ?? bar1m.symbol,
    closedBarCount: state.closedBarCount + 1,
    lastAppliedBarOpenTimeMs: barOpenTimeMs,
    oneMinuteRing: appendToRing(state.oneMinuteRing, bar1m),
  };

  return { ok: true, state: nextState, gapObserved };
}

export function selectMarketCanvasView(state: MarketCanvasState): MarketCanvasView {
  return {
    instrumentId: state.instrumentId,
    closedBarCount: state.closedBarCount,
    recent1m: state.oneMinuteRing,
  };
}
