import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createRecordingLinuxSystemdCampaignControlExecutor } from "@/lib/trader/observability/fhv-linux-systemd-executor";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  assertFhvRehearsalWithinDeadline,
  createFhvRehearsalMonotonicDeadline,
  FhvRehearsalCampaignError,
  FHV_REHEARSAL_CHECKPOINT_CYCLE,
  isFhvResumeFromCheckpointRequested,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalProgressSamples,
  runFhvRehearsalCampaign,
  runFhvRehearsalCampaignParityProof,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-rehearsal-campaign-test";
const ORG_ID = "00000000-0000-4000-8000-000000000416";

function prepareRunDir(root: string, runId: string = RUN_ID): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId,
    organizationId: ORG_ID,
    artifactRoot: root,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

describe("FHV rehearsal campaign runner (DEE-431)", () => {
  it("runs uninterrupted WP03 rehearsal with increasing progress samples", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-uninterrupted-"));
    try {
      const runDir = prepareRunDir(root);
      const result = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(result.classification).toBe("REHEARSAL_OK");
      expect(result.cyclesProcessed).toBeGreaterThan(FHV_REHEARSAL_CHECKPOINT_CYCLE);
      const progress = readFhvRehearsalCampaignProgress(runDir);
      expect(progress?.phase).toBe("completed");
      const samples = readFhvRehearsalProgressSamples(runDir);
      expect(samples.length).toBeGreaterThanOrEqual(2);
      expect(samples.every((value, index) => index === 0 || value > samples[index - 1]!)).toBe(
        true,
      );
      expect(samples.at(-1)).toBe(result.cyclesProcessed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("pauses at checkpoint and resumes with matching economic digest", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-parity-"));
    const uninterruptedRoot = mkdtempSync(join(tmpdir(), "fhv-campaign-uninter-"));
    try {
      const pauseResumeDir = prepareRunDir(root);
      const parity = await runFhvRehearsalCampaignParityProof({
        runRootUninterrupted: prepareRunDir(uninterruptedRoot),
        runRootPauseResume: pauseResumeDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(parity.match).toBe(true);
      expect(readFhvRehearsalCampaignProgress(pauseResumeDir)?.phase).toBe("completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(uninterruptedRoot, { recursive: true, force: true });
    }
  }, 240_000);

  it("executor pause during run then resume marker and systemctl start completes", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-executor-"));
    const checkpointCycle = 5;
    try {
      const runDir = prepareRunDir(root, "fhv-executor-e2e");
      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: runDir,
      });

      const campaignPromise = runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        checkpointCycle,
      });

      const pauseResult = await executor.execute({
        action: "PAUSE_AT_CHECKPOINT",
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        operatorId: "operator-1",
        reason: "hermetic pause test",
      });
      expect(pauseResult.enforcementApplied).toBe(true);

      const paused = await campaignPromise;
      expect(paused.classification).toBe("REHEARSAL_PAUSED");
      const frozenCycles = readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed;
      expect(frozenCycles).toBe(checkpointCycle);

      const stillPaused = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(stillPaused.classification).toBe("REHEARSAL_PAUSED");
      expect(readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed).toBe(frozenCycles);

      const resumeResult = await executor.execute({
        action: "RESUME_FROM_CHECKPOINT",
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        operatorId: "operator-1",
        reason: "hermetic resume test",
      });
      expect(resumeResult.enforcementApplied).toBe(true);
      expect(resumeResult.outcome).toBe("executed");
      expect(executor.systemctlCalls).toHaveLength(1);
      expect(executor.systemctlCalls[0]?.args).toEqual([
        "systemctl",
        "start",
        "waia-fhv-campaign.service",
      ]);
      expect(readFhvRehearsalProgressSamples(runDir).length).toBeGreaterThanOrEqual(1);
      expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(true);

      const completed = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        checkpointCycle,
      });
      expect(completed.classification).toBe("REHEARSAL_OK");
      expect(completed.cyclesProcessed).toBeGreaterThan(checkpointCycle);
      expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(false);
      expect(readReplayCheckpoint(runDir)).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("classifies injected deadline overrun as REHEARSAL_TIMEOUT", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-timeout-"));
    try {
      const runDir = prepareRunDir(root, "fhv-timeout");
      const result = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-timeout",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        monotonicDeadline: createFhvRehearsalMonotonicDeadline(-1),
      });
      expect(result.classification).toBe("REHEARSAL_TIMEOUT");
      expect(readFhvRehearsalCampaignProgress(runDir)?.phase).toBe("timeout");
      expect(existsSync(join(runDir, "fhv-rehearsal-terminal.v1.json"))).toBe(true);
      const terminal = JSON.parse(
        readFileSync(join(runDir, "fhv-rehearsal-terminal.v1.json"), "utf8"),
      ) as { classification: string };
      expect(terminal.classification).toBe("REHEARSAL_TIMEOUT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("assertFhvRehearsalWithinDeadline throws when past", () => {
    try {
      assertFhvRehearsalWithinDeadline({ deadlineMs: Date.now() - 1 });
      expect.fail("expected deadline throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvRehearsalCampaignError);
      expect((error as FhvRehearsalCampaignError).code).toBe("REHEARSAL_DEADLINE_EXCEEDED");
    }
  });
});
