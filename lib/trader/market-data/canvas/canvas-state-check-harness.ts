import fs from "node:fs";
import path from "node:path";

import {
  CANVAS_1M_RING_CAPACITY,
  advanceMarketCanvasClosedBar,
  canvasStateContentDigest,
  createMarketCanvasState,
  readCanvasStateSidecar,
  serializeMarketCanvasState,
  writeCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas";
import type { Bar } from "@/lib/trader/intelligence/types";

export const HTR_WP06_CANVAS_BASELINE_DIR = "replay-runs/RI-P7/htr-wp06-canvas-contract-baseline";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: "42000",
    high: "42100",
    low: "41900",
    close: "42050",
    volume: "12.5",
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1) - 1).toISOString(),
  }));
}

export type CanvasStateCheckHarness = {
  terminalState: "CANVAS_STATE_OK" | "CANVAS_STATE_FAILED";
  closedBarCount: number;
  oneMinuteRingLength: number;
  canvasStateContentDigest: string;
  sidecarRoundTripOk: boolean;
  boundedMemoryOk: boolean;
  cursorProgression: readonly number[];
};

export function runCanvasStateCheckHarness(): CanvasStateCheckHarness {
  let state = createMarketCanvasState();
  const bars = sampleBars(40);
  const cursorProgression: number[] = [];
  let gapCount = 0;

  for (const bar of bars) {
    const result = advanceMarketCanvasClosedBar(state, bar);
    if (!result.ok) {
      return {
        terminalState: "CANVAS_STATE_FAILED",
        closedBarCount: state.closedBarCount,
        oneMinuteRingLength: state.oneMinuteRing.length,
        canvasStateContentDigest: canvasStateContentDigest(state),
        sidecarRoundTripOk: false,
        boundedMemoryOk: false,
        cursorProgression,
      };
    }
    if (result.gapObserved) {
      gapCount += 1;
    }
    state = result.state;
    cursorProgression.push(state.closedBarCount);
  }

  const digest = canvasStateContentDigest(state);
  const serialized = serializeMarketCanvasState(state);
  const runRoot = path.join(process.cwd(), ".tmp-wp06-canvas-check");
  fs.mkdirSync(runRoot, { recursive: true });
  const ref = writeCanvasStateSidecar(runRoot, state);
  const restored = readCanvasStateSidecar(runRoot, ref);
  const sidecarRoundTripOk =
    canvasStateContentDigest(restored) === digest &&
    restored.closedBarCount === state.closedBarCount &&
    restored.oneMinuteRing.length === state.oneMinuteRing.length;

  return {
    terminalState: "CANVAS_STATE_OK",
    closedBarCount: state.closedBarCount,
    oneMinuteRingLength: state.oneMinuteRing.length,
    canvasStateContentDigest: digest,
    sidecarRoundTripOk,
    boundedMemoryOk: state.oneMinuteRing.length <= CANVAS_1M_RING_CAPACITY,
    cursorProgression,
  };
}

export function assertCanvasStateCheckHarness(harness: CanvasStateCheckHarness): void {
  if (harness.terminalState !== "CANVAS_STATE_OK") {
    throw new Error(`Canvas state check failed: ${harness.terminalState}`);
  }
  if (!harness.sidecarRoundTripOk) {
    throw new Error("Canvas sidecar round-trip failed");
  }
  if (!harness.boundedMemoryOk) {
    throw new Error("Canvas 1m ring exceeds CANVAS_1M_RING_CAPACITY");
  }
  if (harness.oneMinuteRingLength > CANVAS_1M_RING_CAPACITY) {
    throw new Error("oneMinuteRing length exceeds bound");
  }
}

export function writeCanvasStateCheckBaseline(harness: CanvasStateCheckHarness): {
  baselineDir: string;
} {
  const baselineDir = path.join(process.cwd(), HTR_WP06_CANVAS_BASELINE_DIR);
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, "canvas-state-check-report.json"),
    `${JSON.stringify(harness, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(baselineDir, "README.md"),
    `# HTR-WP06 Canvas contract baseline\n\nTerminal: ${harness.terminalState}\nDigest: ${harness.canvasStateContentDigest}\n`,
  );
  return { baselineDir };
}
