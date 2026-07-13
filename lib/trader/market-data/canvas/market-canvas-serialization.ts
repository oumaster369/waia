import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { canonicalJsonString } from "@/lib/trader/research/digest";

import {
  CANVAS_SIDECAR_MAX_BYTES,
  CanvasStateError,
  MARKET_CANVAS_SCHEMA_VERSION,
  type MarketCanvasState,
  type SerializedMarketCanvasState,
} from "@/lib/trader/market-data/canvas/market-canvas.types";

const CANVAS_STATE_DIR = "canvas-state";

function canonicalSerialize(state: MarketCanvasState): string {
  return canonicalJsonString(state);
}

export function serializeMarketCanvasState(state: MarketCanvasState): SerializedMarketCanvasState {
  return { ...state };
}

export function restoreMarketCanvasState(
  serialized: SerializedMarketCanvasState,
): MarketCanvasState {
  if (serialized.schemaVersion !== MARKET_CANVAS_SCHEMA_VERSION) {
    throw new CanvasStateError(
      "CANVAS_STATE_UNRECOVERABLE",
      `Unknown MARKET_CANVAS_SCHEMA_VERSION: ${String(serialized.schemaVersion)}`,
    );
  }
  return {
    schemaVersion: MARKET_CANVAS_SCHEMA_VERSION,
    instrumentId: serialized.instrumentId,
    closedBarCount: serialized.closedBarCount,
    lastAppliedBarOpenTimeMs: serialized.lastAppliedBarOpenTimeMs,
    oneMinuteRing: [...serialized.oneMinuteRing],
    ...(serialized.mtf ? { mtf: serialized.mtf } : {}),
    ...(serialized.reconstruction ? { reconstruction: serialized.reconstruction } : {}),
  };
}

export function canvasStateContentDigest(state: MarketCanvasState): string {
  return computePayloadDigest(state);
}

export function estimateSerializedCanvasBytes(state: MarketCanvasState): number {
  return Buffer.byteLength(canonicalSerialize(state), "utf8");
}

export function writeCanvasStateSidecar(runRootDir: string, state: MarketCanvasState): string {
  const bytes = estimateSerializedCanvasBytes(state);
  if (bytes > CANVAS_SIDECAR_MAX_BYTES) {
    throw new CanvasStateError(
      "CANVAS_STATE_OVERSIZE",
      `Canvas sidecar exceeds CANVAS_SIDECAR_MAX_BYTES (${bytes} > ${CANVAS_SIDECAR_MAX_BYTES})`,
    );
  }
  const digest = canvasStateContentDigest(state);
  const ref = `${CANVAS_STATE_DIR}/${digest}.json`;
  const dir = join(runRootDir, CANVAS_STATE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileAtomic(join(runRootDir, ref), canonicalSerialize(state));
  return ref;
}

export function readCanvasStateSidecar(
  runRootDir: string,
  canvasStateRef: string,
): MarketCanvasState {
  const filePath = join(runRootDir, canvasStateRef);
  if (!existsSync(filePath)) {
    throw new CanvasStateError(
      "CANVAS_STATE_UNRECOVERABLE",
      `Missing canvas sidecar: ${canvasStateRef}`,
    );
  }
  const raw = readFileSync(filePath, "utf8");
  const filenameDigest = canvasStateRef.replace(`${CANVAS_STATE_DIR}/`, "").replace(/\.json$/, "");
  const contentDigest = createHash("sha256").update(raw, "utf8").digest("hex");
  if (contentDigest !== filenameDigest) {
    throw new CanvasStateError(
      "CANVAS_STATE_UNRECOVERABLE",
      `Canvas sidecar digest mismatch for ${canvasStateRef}`,
    );
  }
  let parsed: SerializedMarketCanvasState;
  try {
    parsed = JSON.parse(raw) as SerializedMarketCanvasState;
  } catch {
    throw new CanvasStateError(
      "CANVAS_STATE_UNRECOVERABLE",
      `Unparseable canvas sidecar: ${canvasStateRef}`,
    );
  }
  return restoreMarketCanvasState(parsed);
}
