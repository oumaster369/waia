import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import {
  buildReplayRunChainManifest,
  writeReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { validateFhvCanonicalRunChainCompletion } from "@/lib/trader/observability/fhv-canonical-run-chain";
import { resolveFhvCampaignState } from "@/lib/trader/observability/fhv-campaign-state";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  readFhvRehearsalCampaignProgress,
  runFhvRehearsalCampaign,
  waitForFhvRehearsalCycles,
  writeFhvCampaignControlPauseRequest,
  writeFhvCampaignControlResumeRequest,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-canonical-completion";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

function prepareRunDir(root: string): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId: RUN_ID,
    organizationId: ORG_ID,
    artifactRoot: root,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

describe("FHV canonical run-chain terminal completion (DEE-431)", () => {
  it("classifies valid complete run-chain as COMPLETED_OK", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-canonical-ok-"));
    try {
      const runDir = prepareRunDir(root);
      const pausePromise = runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      await waitForFhvRehearsalCycles(runDir, 5);
      writeFhvCampaignControlPauseRequest(runDir, RUN_ID, ORG_ID);
      await pausePromise;
      writeFhvCampaignControlResumeRequest(runDir, RUN_ID, ORG_ID);
      await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });

      expect(validateFhvCanonicalRunChainCompletion(runDir).ok).toBe(true);
      expect(
        resolveFhvCampaignState({ runRoot: runDir, runId: RUN_ID, organizationId: ORG_ID }).state,
      ).toBe("COMPLETED_OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("does not classify gapped authoritative OK segment as COMPLETED_OK", async () => {
    const harness = await runCheckpointResumeHarness();
    const partialDir = join(harness.runRootDir, "segments", "partial-interrupted");
    const partialReconstruction = reconstructStreamingEvidence(partialDir);
    const badRoot = mkdtempSync(join(tmpdir(), "fhv-canonical-gap-"));
    writeReplayRunChainManifest(
      badRoot,
      buildReplayRunChainManifest({
        backtestRunId: "gap-run",
        activePhase: "validation",
        segments: [
          {
            runDir: partialDir,
            chainDigest: partialReconstruction.chainDigest ?? "",
            role: "authoritative",
            terminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
            sealedThroughCycleIndex: partialReconstruction.sealedThroughCycleIndex,
          },
        ],
      }),
    );
    expect(validateFhvCanonicalRunChainCompletion(badRoot).ok).toBe(false);
    expect(
      resolveFhvCampaignState({
        runRoot: badRoot,
        runId: RUN_ID,
        organizationId: ORG_ID,
      }).state,
    ).toBe("FAILED_NONRESUMABLE");
    rmSync(badRoot, { recursive: true, force: true });
    rmSync(harness.runRootDir, { recursive: true, force: true });
  }, 240_000);

  it("treats stale REHEARSAL_OK terminal with invalid run-chain as INCONSISTENT", async () => {
    const harness = await runCheckpointResumeHarness();
    const continuationDir = join(harness.runRootDir, "segments", "continuation");
    const reconstruction = reconstructStreamingEvidence(continuationDir);
    const badRootParent = mkdtempSync(join(tmpdir(), "fhv-canonical-stale-"));
    const { runDir: badRoot } = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: badRootParent,
      }),
    );
    writeReplayRunChainManifest(
      badRoot,
      buildReplayRunChainManifest({
        backtestRunId: "stale-terminal",
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
    writeFileSync(
      join(badRoot, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
    );
    writeFileSync(
      join(badRoot, "fhv-rehearsal-campaign-progress.v1.json"),
      `${JSON.stringify(
        {
          schemaVersion: "fhv-rehearsal-campaign-progress/v1",
          runId: RUN_ID,
          cyclesProcessed: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
          expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
          phase: "completed",
          updatedAtUtc: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    expect(
      resolveFhvCampaignState({
        runRoot: badRoot,
        runId: RUN_ID,
        organizationId: ORG_ID,
      }).state,
    ).toBe("INCONSISTENT");

    await expect(
      runFhvRehearsalCampaign({
        runRoot: badRoot,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      }),
    ).rejects.toThrow(/contradicted by run-chain/);

    rmSync(badRootParent, { recursive: true, force: true });
    rmSync(harness.runRootDir, { recursive: true, force: true });
  }, 240_000);

  it("returns REHEARSAL_OK without replay after valid canonical completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-canonical-no-replay-"));
    try {
      const runDir = prepareRunDir(root);
      const pausePromise = runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      await waitForFhvRehearsalCycles(runDir, 5);
      writeFhvCampaignControlPauseRequest(runDir, RUN_ID, ORG_ID);
      await pausePromise;
      writeFhvCampaignControlResumeRequest(runDir, RUN_ID, ORG_ID);
      await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });

      const before = readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed ?? 0;
      const again = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(again.classification).toBe("REHEARSAL_OK");
      expect(readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});
