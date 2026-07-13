export {
  CANVAS_1M_RING_CAPACITY,
  CANVAS_SIDECAR_MAX_BYTES,
  CanvasStateError,
  MARKET_CANVAS_SCHEMA_VERSION,
  type CanvasAdvanceError,
  type CanvasAdvanceResult,
  type CanvasClosedBar,
  type MarketCanvasState,
  type MarketCanvasView,
  type SerializedMarketCanvasState,
} from "@/lib/trader/market-data/canvas/market-canvas.types";

export {
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
  selectMarketCanvasView,
} from "@/lib/trader/market-data/canvas/market-canvas";

export {
  canvasStateContentDigest,
  estimateSerializedCanvasBytes,
  readCanvasStateSidecar,
  restoreMarketCanvasState,
  serializeMarketCanvasState,
  writeCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas/market-canvas-serialization";
