import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  readReplayCheckpoint,
  writeReplayCheckpoint,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  CANVAS_1M_RING_CAPACITY,
  advanceMarketCanvasClosedBar,
  createMarketCanvasState,
  readCanvasStateSidecar,
  writeCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas";
import { advanceBars, makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

describe("trader market canvas cursor (HTR-WP06)", () => {
  it("advances exactly one closed 1m bar per call", () => {
    const state = createMarketCanvasState();
    const bar = makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" });
    const result = advanceMarketCanvasClosedBar(state, bar);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.closedBarCount).toBe(1);
    expect(result.state.oneMinuteRing).toHaveLength(1);
  });

  it("closedBarCount is monotonic over sequential bars", () => {
    let state = createMarketCanvasState();
    for (let i = 0; i < 5; i += 1) {
      const open = new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString();
      const result = advanceMarketCanvasClosedBar(state, makeCanvasBar1m({ barOpenTime: open }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.closedBarCount).toBe(i + 1);
      state = result.state;
    }
  });

  it("deterministic replay produces identical final state", () => {
    const bars = Array.from({ length: 10 }, (_, i) =>
      makeCanvasBar1m({
        barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
      }),
    );
    const a = advanceBars(createMarketCanvasState(), bars);
    const b = advanceBars(createMarketCanvasState(), bars);
    expect(a).toEqual(b);
  });

  it("evicts oldest bars from the 1m ring at capacity 32", () => {
    const bars = Array.from({ length: CANVAS_1M_RING_CAPACITY + 5 }, (_, i) =>
      makeCanvasBar1m({
        barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
      }),
    );
    const state = advanceBars(createMarketCanvasState(), bars);
    expect(state.oneMinuteRing).toHaveLength(CANVAS_1M_RING_CAPACITY);
    expect(state.oneMinuteRing[0]?.barOpenTime).toBe(bars[5]?.barOpenTime);
    expect(state.closedBarCount).toBe(CANVAS_1M_RING_CAPACITY + 5);
  });

  it("sidecar round-trips through canvasStateRef + checkpoint", () => {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp06-canvas-"));
    const state = advanceBars(createMarketCanvasState(), [
      makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" }),
      makeCanvasBar1m({ barOpenTime: "2024-01-01T00:01:00.000Z" }),
    ]);
    const canvasStateRef = writeCanvasStateSidecar(runRoot, state);
    writeReplayCheckpoint(runRoot, {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: "wp06-canvas",
      datasetContentDigest: "digest",
      datasetId: "dataset",
      codeSha: "sha",
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: -1,
      safeResumeThroughCycleIndex: -1,
      evidenceRunDir: runRoot,
      evidenceChainDigest: null,
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "test",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      canvasStateRef,
      checkpointDigest: "",
    });
    const checkpoint = readReplayCheckpoint(runRoot);
    expect(checkpoint?.canvasStateRef).toBe(canvasStateRef);
    const restored = readCanvasStateSidecar(runRoot, canvasStateRef);
    expect(restored).toEqual(state);
  });

  it("absent canvasStateRef is back-compatible (no restore attempted)", () => {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp06-no-canvas-"));
    writeReplayCheckpoint(runRoot, {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: "wp06-no-canvas",
      datasetContentDigest: "digest",
      datasetId: "dataset",
      codeSha: "sha",
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: -1,
      safeResumeThroughCycleIndex: -1,
      evidenceRunDir: runRoot,
      evidenceChainDigest: null,
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "test",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      checkpointDigest: "",
    });
    const checkpoint = readReplayCheckpoint(runRoot);
    expect(checkpoint?.canvasStateRef).toBeUndefined();
  });
});
