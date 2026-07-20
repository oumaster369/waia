import type { Bar } from "@/lib/trader/intelligence/types";

import type { MtfDomainState, MtfView } from "@/lib/trader/market-data/canvas/incremental-mtf";
import type { ReconstructionDomainState } from "@/lib/trader/market-data/canvas/incremental-reconstruction";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";

/** WP06-OWNED ONLY — WP07 widens with optional `mtf`; WP08 adds optional `reconstruction`. */
export const MARKET_CANVAS_SCHEMA_VERSION = "waia.trader.canvas.v1" as const;

export const CANVAS_1M_RING_CAPACITY = 32;

export const CANVAS_SIDECAR_MAX_BYTES = 262144;

export type CanvasClosedBar = Bar;

export type MarketCanvasState = Readonly<{
  schemaVersion: typeof MARKET_CANVAS_SCHEMA_VERSION;
  instrumentId: string | null;
  closedBarCount: number;
  lastAppliedBarOpenTimeMs: number | null;
  oneMinuteRing: readonly CanvasClosedBar[];
  mtf?: MtfDomainState;
  reconstruction?: ReconstructionDomainState;
}>;

export type MarketCanvasView = Readonly<{
  instrumentId: string | null;
  closedBarCount: number;
  recent1m: readonly CanvasClosedBar[];
  mtf?: MtfView;
  reconstruction?: ReconstructionSnapshot | null;
}>;

export type SerializedMarketCanvasState = MarketCanvasState;

export type CanvasAdvanceError =
  | "CANVAS_INSTRUMENT_MISMATCH"
  | "CANVAS_1M_DUPLICATE_BAR"
  | "CANVAS_1M_OUT_OF_ORDER"
  | "CANVAS_1M_INVALID_TIMESTAMP"
  | "CANVAS_1M_INVALID_OHLCV";

export type CanvasAdvanceResult =
  | { ok: true; state: MarketCanvasState; gapObserved: boolean }
  | { ok: false; error: CanvasAdvanceError; state: MarketCanvasState };

export class CanvasStateError extends Error {
  readonly code: "CANVAS_STATE_UNRECOVERABLE" | "CANVAS_STATE_OVERSIZE";

  constructor(code: CanvasStateError["code"], message: string) {
    super(message);
    this.name = "CanvasStateError";
    this.code = code;
  }
}
