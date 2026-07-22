import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { restoreCanvasFromCheckpoint } from "@/lib/trader/backtest/canvas-checkpoint-integration";
import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  computeSemanticParityDigest,
  readReplayRunChainProjections,
  readSegmentProjections,
} from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import { createRecordingLinuxSystemdCampaignControlExecutor } from "@/lib/trader/observability/fhv-linux-systemd-executor";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvEvidenceHealth } from "@/lib/trader/observability/fhv-observer-core";
import { resolveFhvCampaignState } from "@/lib/trader/observability/fhv-campaign-state";
import {
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalProgressSamples,
  runFhvRehearsalCampaign,
  resolveFhvRehearsalEvidenceDir,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { segmentRole } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-true-incremental-resume";
const ORG_ID = "00000000-0000-4000-8000-000000000431";
const PAUSE_AFTER_CYCLES = 45;

async function pauseViaExecutorWhenCyclesReach(input: {
  runDir: string;
  minCycles: number;
  executor: ReturnType<typeof createRecordingLinuxSystemdCampaignControlExecutor>;
}): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const cyclesProcessed = readFhvRehearsalCampaignProgress(input.runDir)?.cyclesProcessed ?? 0;
    if (cyclesProcessed >= input.minCycles) {
      await input.executor.execute({
        action: "PAUSE_AT_CHECKPOINT",
        runId: RUN_ID,
        organizationId: ORG_ID,
        operatorId: "true-resume-operator",
        reason: "true incremental resume proof pause",
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting to pause at ${input.minCycles} cycles.`);
}

describe("FHV true incremental checkpoint resume (DEE-431)", () => {
  it("restores canvas, resumes at exact frontier, and proves dual-authoritative parity", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-true-resume-"));
    try {
      const uninterruptedConfig = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: join(root, "reference"),
      });
      const pauseResumeConfig = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: join(root, "campaign"),
      });
      const uninterruptedDir = materializeFhvRehearsalManifest(uninterruptedConfig).runDir;
      const runDir = materializeFhvRehearsalManifest(pauseResumeConfig).runDir;

      const uninterrupted = await runFhvRehearsalCampaign({
        runRoot: uninterruptedDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      const uninterruptedDigest = computeSemanticParityDigest(
        readSegmentProjections(resolveFhvRehearsalEvidenceDir(uninterruptedDir)),
      );

      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: runDir,
      });

      const pausePromise = runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      await pauseViaExecutorWhenCyclesReach({
        runDir,
        minCycles: PAUSE_AFTER_CYCLES,
        executor,
      });
      const paused = await pausePromise;
      expect(paused.classification).toBe("REHEARSAL_PAUSED");

      const actualPauseCycle = readFhvRehearsalActualPauseCycle(runDir);
      expect(actualPauseCycle).toBeGreaterThanOrEqual(PAUSE_AFTER_CYCLES);
      const checkpoint = readReplayCheckpoint(runDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.safeResumeThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(checkpoint!.evidenceDurableThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(restoreCanvasFromCheckpoint(runDir, checkpoint!)).not.toBeUndefined();

      const pausedSamples = readFhvRehearsalProgressSamples(runDir);
      const pausedProgress = readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed ?? 0;
      expect(pausedProgress).toBe(actualPauseCycle);

      const resumeResult = await executor.execute({
        action: "RESUME_FROM_CHECKPOINT",
        runId: RUN_ID,
        organizationId: ORG_ID,
        operatorId: "true-resume-operator",
        reason: "true incremental resume proof",
      });
      expect(resumeResult.outcome).toBe("executed");

      const rescanBefore = getFullHistoryRescanCount();
      const completed = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(getFullHistoryRescanCount()).toBe(rescanBefore);

      expect(completed.classification).toBe("REHEARSAL_OK");
      expect(completed.semanticReproDigest).toBe(uninterrupted.semanticReproDigest);

      const continuationDir = join(runDir, "streaming-evidence-resume");
      const continuationProjections = readSegmentProjections(continuationDir);
      expect(continuationProjections.length).toBeGreaterThan(0);
      expect(continuationProjections[0]!.cycleIndex).toBe(actualPauseCycle);
      expect(
        continuationProjections.every((projection) => projection.cycleIndex >= actualPauseCycle!),
      ).toBe(true);

      const samples = readFhvRehearsalProgressSamples(runDir);
      expect(samples.every((value, index) => index === 0 || value > samples[index - 1]!)).toBe(
        true,
      );
      expect(samples.some((value) => value > pausedProgress)).toBe(true);
      expect(samples.at(-1)).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);

      const chainRead = readReplayRunChainProjections(runDir);
      expect(chainRead.authoritativeGapCount).toBe(0);
      expect(chainRead.authoritativeDuplicateCount).toBe(0);
      expect(chainRead.authoritativeCycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
      expect(chainRead.semanticParityDigest).toBe(uninterruptedDigest);
      expect(readFhvEvidenceHealth(runDir)).toBe("ok");
      expect(
        resolveFhvCampaignState({ runRoot: runDir, runId: RUN_ID, organizationId: ORG_ID }).state,
      ).toBe("COMPLETED_OK");

      const runChain = chainRead.manifest;
      expect(runChain.segments).toHaveLength(2);
      expect(runChain.segments.every((segment) => segmentRole(segment) === "authoritative")).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});
