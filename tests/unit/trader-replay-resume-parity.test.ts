import { describe, expect, it } from "vitest";

import {
  assertCheckpointResumeHarness,
  runCheckpointResumeHarness,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import {
  assertCanvasIncrementalCheckpointResumeHarness,
  runCanvasIncrementalCheckpointResumeHarness,
} from "@/lib/trader/backtest/canvas-checkpoint-resume-harness";
import { CanvasStateError } from "@/lib/trader/market-data/canvas/market-canvas.types";
import {
  writeCanvasStateSidecar,
  readCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import {
  createInitialCanvasState,
  applyNewBarsToCanvas,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("trader replay resume parity (HTR-WP05)", () => {
  it("resumed composed outputs match uninterrupted execution", async () => {
    const harness = await runCheckpointResumeHarness();
    assertCheckpointResumeHarness(harness);
    expect(harness.parity.evidenceDigestMatch).toBe(true);
    expect(harness.parity.semanticReproDigestMatch).toBe(true);
    expect(harness.parity.cycleCountMatch).toBe(true);

    // Phase-B core: the same semantic-parity digest is computed for BOTH runs over the same
    // normalized authoritative projection stream, and they are equal.
    expect(harness.uninterruptedSemanticParityDigest).toBeTruthy();
    expect(harness.resumedSemanticParityDigest).toBeTruthy();
    expect(harness.parity.semanticParityDigestMatch).toBe(true);
    expect(harness.resumedSemanticParityDigest).toBe(harness.uninterruptedSemanticParityDigest);

    // Authoritative composed stream: one projection per expected cycle, no duplicates, no gaps.
    expect(harness.authoritativeStream.duplicateCount).toBe(0);
    expect(harness.authoritativeStream.gapCount).toBe(0);
    expect(harness.authoritativeStream.cycleCount).toBe(harness.uninterrupted.cycleCount);
    // The interrupted partial attempt is preserved as a superseded audit segment.
    expect(harness.authoritativeStream.supersededSegmentCount).toBe(1);
    expect(harness.terminalState).toBe("REPLAY_RUN_OK");
  }, 240_000);

  it("incremental canvas checkpoint/resume preserves exact semantic parity", async () => {
    const harness = await runCanvasIncrementalCheckpointResumeHarness(40);
    assertCanvasIncrementalCheckpointResumeHarness(harness);
    expect(harness.parity.fullHistoryRescansZero).toBe(true);
  }, 240_000);

  it("fails closed on corrupt canvas sidecar digest", () => {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp09-canvas-sidecar-"));
    const bars = [makeCanvasBar1m({ barOpenTime: "2024-01-01T00:00:00.000Z" })];
    const state = applyNewBarsToCanvas(createInitialCanvasState(), bars, 0).state;
    const ref = writeCanvasStateSidecar(runRoot, state);
    const filePath = path.join(runRoot, ref);
    fs.writeFileSync(filePath, `${fs.readFileSync(filePath, "utf8")}corrupt`, "utf8");
    expect(() => readCanvasStateSidecar(runRoot, ref)).toThrow(CanvasStateError);
  });
});
