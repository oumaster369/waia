import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import {
  buildReplayRunChainManifest,
  writeReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  computeSemanticParityDigest,
  readReplayRunChainProjections,
  readSegmentProjections,
} from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  runFhvRehearsalCampaign,
  writeFhvCampaignControlResumeRequest,
  resolveFhvRehearsalEvidenceDir,
  FHV_REHEARSAL_CHECKPOINT_CYCLE,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { readFhvEvidenceHealth } from "@/lib/trader/observability/fhv-observer-core";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-authoritative-chain";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

function prepareRunDir(root: string, runId: string): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId,
    organizationId: ORG_ID,
    artifactRoot: root,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

describe("FHV authoritative run-chain composition (DEE-431)", () => {
  it("matches uninterrupted semantic parity for genuine incremental authoritative chain", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-chain-parity-"));
    try {
      const uninterruptedDir = prepareRunDir(join(root, "uninterrupted"), RUN_ID);
      const pauseResumeDir = prepareRunDir(join(root, "pause-resume"), RUN_ID);

      await runFhvRehearsalCampaign({
        runRoot: uninterruptedDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });

      const pausePromise = runFhvRehearsalCampaign({
        runRoot: pauseResumeDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        testOnlyPauseAfterCycles: FHV_REHEARSAL_CHECKPOINT_CYCLE,
      });
      const paused = await pausePromise;
      expect(paused.classification).toBe("REHEARSAL_PAUSED");

      writeFhvCampaignControlResumeRequest(pauseResumeDir, RUN_ID, ORG_ID);
      const completed = await runFhvRehearsalCampaign({
        runRoot: pauseResumeDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(completed.classification).toBe("REHEARSAL_OK");

      const uninterruptedDigest = computeSemanticParityDigest(
        readSegmentProjections(resolveFhvRehearsalEvidenceDir(uninterruptedDir)),
      );
      const chainRead = readReplayRunChainProjections(pauseResumeDir);
      expect(chainRead.authoritativeGapCount).toBe(0);
      expect(chainRead.authoritativeDuplicateCount).toBe(0);
      expect(chainRead.authoritativeCycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
      expect(chainRead.semanticParityDigest).toBe(uninterruptedDigest);
      expect(readFhvEvidenceHealth(pauseResumeDir)).toBe("ok");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("fails evidence health when canonical projection composition fails", async () => {
    const harness = await runCheckpointResumeHarness();
    const continuationDir = join(harness.runRootDir, "segments", "continuation");
    const reconstruction = reconstructStreamingEvidence(continuationDir);
    const badRoot = mkdtempSync(join(tmpdir(), "fhv-run-chain-bad-"));
    writeReplayRunChainManifest(
      badRoot,
      buildReplayRunChainManifest({
        backtestRunId: "bad-overlap",
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
      }),
    );
    expect(readFhvEvidenceHealth(badRoot)).toBe("failed");
    rmSync(badRoot, { recursive: true, force: true });
    rmSync(harness.runRootDir, { recursive: true, force: true });
  }, 240_000);
});
