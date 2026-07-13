import type { MarketCanvasState } from "@/lib/trader/market-data/canvas/market-canvas.types";
import {
  canvasStateContentDigest,
  readCanvasStateSidecar,
  writeCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import {
  readReplayCheckpoint,
  writeReplayCheckpoint,
  type ReplayCheckpointRecord,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

export function restoreCanvasFromCheckpoint(
  runRootDir: string,
  checkpoint: ReplayCheckpointRecord,
): MarketCanvasState | undefined {
  if (!checkpoint.canvasStateRef) {
    return undefined;
  }
  return readCanvasStateSidecar(runRootDir, checkpoint.canvasStateRef);
}

export function writeCanvasSidecarBeforeCheckpoint(input: {
  runRootDir: string;
  canvasState: MarketCanvasState;
  checkpoint: Omit<ReplayCheckpointRecord, "canvasStateRef" | "checkpointDigest">;
}): ReplayCheckpointRecord {
  const canvasStateRef = writeCanvasStateSidecar(input.runRootDir, input.canvasState);
  const record: ReplayCheckpointRecord = {
    ...input.checkpoint,
    canvasStateRef,
    checkpointDigest: "",
  };
  writeReplayCheckpoint(input.runRootDir, record);
  return readReplayCheckpoint(input.runRootDir)!;
}

export function assertCanvasDigestStable(
  before: MarketCanvasState,
  after: MarketCanvasState,
): void {
  if (canvasStateContentDigest(before) !== canvasStateContentDigest(after)) {
    throw new Error("CANVAS_CHECKPOINT_DIGEST_MISMATCH");
  }
}
