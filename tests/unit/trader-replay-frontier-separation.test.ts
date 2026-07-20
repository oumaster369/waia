import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import {
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  dbPhaseFrontierFromCommittedPhases,
  readReplayCheckpoint,
  resolveResumeBoundary,
  writeReplayCheckpoint,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

describe("trader replay frontier separation (HTR-WP05)", () => {
  it("does not advance safe resume when evidence is ahead of DB frontier", async () => {
    const harness = await runCheckpointResumeHarness();
    expect(harness.frontierSeparation.passed).toBe(true);
    expect(harness.frontierSeparation.safeResumeThroughCycleIndex).toBe(-1);
    expect(harness.frontierSeparation.evidenceAheadCycleIndex).toBeGreaterThanOrEqual(0);
  }, 240_000);

  it("does not advance safe resume when DB is ahead of verified evidence", () => {
    // Validation DB phase committed through cycle 80, but its evidence runDir is missing (crash
    // window: DB committed, evidence not durable) → evidence frontier -1 → safe resume -1.
    const frontier = dbPhaseFrontierFromCommittedPhases({
      validationResultCommitted: true,
      validationLastCycleIndex: 80,
      walkForwardWindowCount: 0,
      walkForwardLastCycleIndex: -1,
      blindResultCommitted: false,
      blindLastCycleIndex: -1,
    });
    const boundary = resolveResumeBoundary({
      activePhase: "walk-forward:0",
      dbDurablePhaseRunDir: path.join(os.tmpdir(), "waia-wp05-missing-evidence-does-not-exist"),
      dbFrontier: frontier,
      phaseLastCycleIndex: { validation: 80 },
    });
    expect(boundary.dbDurableThroughCycleIndex).toBe(80);
    expect(boundary.evidenceDurableThroughCycleIndex).toBe(-1);
    expect(boundary.safeResumeThroughCycleIndex).toBe(-1);
  });

  it("reconstructs the boundary from DB+evidence when no checkpoint exists", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp05-nockpt-"));
    // Missing checkpoint is not an error — the boundary is recomputed from durable authorities.
    expect(readReplayCheckpoint(emptyRoot)).toBeNull();
    const boundary = resolveResumeBoundary({
      activePhase: "validation",
      dbDurablePhaseRunDir: null,
      dbFrontier: dbPhaseFrontierFromCommittedPhases({
        validationResultCommitted: false,
        validationLastCycleIndex: -1,
        walkForwardWindowCount: 0,
        walkForwardLastCycleIndex: -1,
        blindResultCommitted: false,
        blindLastCycleIndex: -1,
      }),
      phaseLastCycleIndex: {},
    });
    expect(boundary.safeResumeThroughCycleIndex).toBe(-1);
  });

  it("recomputed boundary wins over a stale checkpoint value (checkpoint is a cache)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp05-stale-"));
    // Stale checkpoint claims safe resume 80, but no evidence/DB is durable.
    writeReplayCheckpoint(root, {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: "run-stale",
      datasetContentDigest: "digest-a",
      datasetId: "dataset-1",
      codeSha: "sha-1",
      activePhase: "validation",
      dbDurableThroughPhase: "validation",
      evidenceDurableThroughCycleIndex: 80,
      safeResumeThroughCycleIndex: 80,
      evidenceRunDir: root,
      evidenceChainDigest: null,
      evidenceTerminalState: "STREAMING_EVIDENCE_OK",
      dbConnectionMode: "test",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      checkpointDigest: "",
    });
    const checkpoint = readReplayCheckpoint(root);
    expect(checkpoint?.safeResumeThroughCycleIndex).toBe(80);
    // Recompute from durable authorities (none committed) — the authoritative answer is -1.
    const recomputed = resolveResumeBoundary({
      activePhase: "validation",
      dbDurablePhaseRunDir: null,
      dbFrontier: dbPhaseFrontierFromCommittedPhases({
        validationResultCommitted: false,
        validationLastCycleIndex: -1,
        walkForwardWindowCount: 0,
        walkForwardLastCycleIndex: -1,
        blindResultCommitted: false,
        blindLastCycleIndex: -1,
      }),
      phaseLastCycleIndex: {},
    });
    expect(recomputed.safeResumeThroughCycleIndex).toBe(-1);
    expect(recomputed.safeResumeThroughCycleIndex).not.toBe(
      checkpoint?.safeResumeThroughCycleIndex,
    );
  });
});
