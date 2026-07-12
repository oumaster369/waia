import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import {
  ReplayCheckpointError,
  buildReplayRunChainManifest,
  readReplayRunChainManifest,
  segmentRole,
  writeReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { readReplayRunChainProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";

describe("trader replay continuation segment (HTR-WP05)", () => {
  it("retains an immutable superseded partial and one authoritative continuation", async () => {
    const harness = await runCheckpointResumeHarness();
    const partialManifestPath = path.join(
      harness.runRootDir,
      "segments",
      "partial-interrupted",
      "manifest.partial.json",
    );
    const partialCompletePath = path.join(
      harness.runRootDir,
      "segments",
      "partial-interrupted",
      "manifest.json",
    );
    // WP04 seal-once: partial segment keeps only manifest.partial.json (no dual manifest).
    expect(fs.existsSync(partialManifestPath)).toBe(true);
    expect(fs.existsSync(partialCompletePath)).toBe(false);

    const chain = readReplayRunChainManifest(harness.runRootDir);
    expect(chain?.segments).toHaveLength(2);
    const superseded = chain!.segments.filter((s) => segmentRole(s) === "superseded");
    const authoritative = chain!.segments.filter((s) => segmentRole(s) === "authoritative");
    expect(superseded).toHaveLength(1);
    expect(authoritative).toHaveLength(1);
    expect(superseded[0]?.runDir).toContain("partial-interrupted");
    expect(authoritative[0]?.continuesFromRunDir).toContain("partial-interrupted");

    // Composed authoritative stream excludes the superseded attempt; no dup/gap.
    const read = readReplayRunChainProjections(harness.runRootDir);
    expect(read.authoritativeDuplicateCount).toBe(0);
    expect(read.authoritativeGapCount).toBe(0);
    expect(read.supersededSegmentRunDirs).toHaveLength(1);
  }, 240_000);

  it("rejects overlap between two simultaneously authoritative segments", async () => {
    const harness = await runCheckpointResumeHarness();
    const continuationDir = path.join(harness.runRootDir, "segments", "continuation");
    const reconstruction = reconstructStreamingEvidence(continuationDir);

    // Two authoritative segments both starting at cycle 0 → overlap inside the authoritative stream.
    const overlapRoot = fs.mkdtempSync(path.join(harness.runRootDir, "overlap-"));
    const manifest = buildReplayRunChainManifest({
      backtestRunId: "overlap-run",
      activePhase: "validation",
      segments: [
        {
          runDir: continuationDir,
          chainDigest: reconstruction.chainDigest ?? "",
          role: "authoritative",
          terminalState: "STREAMING_EVIDENCE_OK",
          sealedThroughCycleIndex: reconstruction.sealedThroughCycleIndex,
        },
        {
          runDir: continuationDir,
          chainDigest: reconstruction.chainDigest ?? "",
          role: "authoritative",
          terminalState: "STREAMING_EVIDENCE_OK",
          sealedThroughCycleIndex: reconstruction.sealedThroughCycleIndex,
        },
      ],
    });
    writeReplayRunChainManifest(overlapRoot, manifest);
    expect(() => readReplayRunChainProjections(overlapRoot)).toThrow(ReplayCheckpointError);
  }, 240_000);
});
