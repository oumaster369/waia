import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  ReplayCheckpointError,
  compareReplayResumeIdentity,
  readReplayCheckpoint,
  resolveResumeBoundary,
  writeReplayCheckpoint,
  emptyDbPhaseFrontier,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

describe("trader replay checkpoint (HTR-WP05)", () => {
  it("writes and reads a digest-guarded checkpoint", () => {
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp05-checkpoint-"));
    writeReplayCheckpoint(runRoot, {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: "run-1",
      datasetContentDigest: "digest-a",
      datasetId: "dataset-1",
      codeSha: "sha-1",
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
    const loaded = readReplayCheckpoint(runRoot);
    expect(loaded?.backtestRunId).toBe("run-1");
    expect(loaded?.schemaVersion).toBe(REPLAY_CHECKPOINT_SCHEMA_VERSION);
  });

  it("rejects identity mismatch", () => {
    expect(() =>
      compareReplayResumeIdentity(
        { backtestRunId: "a", datasetContentDigest: "d1", codeSha: "c1" },
        { backtestRunId: "b", datasetContentDigest: "d1", codeSha: "c1" },
      ),
    ).toThrow(ReplayCheckpointError);
  });

  it("separates evidence ahead of DB frontier (crash window 3)", () => {
    const boundary = resolveResumeBoundary({
      activePhase: "validation",
      dbDurablePhaseRunDir: null,
      dbFrontier: emptyDbPhaseFrontier(),
      phaseLastCycleIndex: {},
    });
    expect(boundary.safeResumeThroughCycleIndex).toBe(-1);
    expect(boundary.dbDurableThroughCycleIndex).toBe(-1);
  });
});
