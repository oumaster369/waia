import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { restoreCanvasFromCheckpoint } from "@/lib/trader/backtest/canvas-checkpoint-integration";
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
  FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES,
  isFhvResumeFromCheckpointRequested,
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalEvidenceTerminalState,
  readFhvRehearsalProgressSamples,
  readFhvRehearsalTerminalClassification,
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

async function pauseViaExecutorWhenCyclesReach(input: {
  runDir: string;
  minCycles: number;
  executor: ReturnType<typeof createRecordingLinuxSystemdCampaignControlExecutor>;
  runId: string;
}): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const cyclesProcessed = readFhvRehearsalCampaignProgress(input.runDir)?.cyclesProcessed ?? 0;
    if (cyclesProcessed >= input.minCycles) {
      await input.executor.execute({
        action: "PAUSE_AT_CHECKPOINT",
        runId: input.runId,
        organizationId: ORG_ID,
        operatorId: "operator-1",
        reason: "hermetic in-run pause",
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting to pause at ${input.minCycles} cycles.`);
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
      expect(readFhvRehearsalEvidenceTerminalState(runDir)).toBe("STREAMING_EVIDENCE_OK");
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
    const pauseAfterCycles = 5;
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
      });

      const pausePromise = pauseViaExecutorWhenCyclesReach({
        runDir,
        minCycles: pauseAfterCycles,
        executor,
        runId: "fhv-executor-e2e",
      });
      await pausePromise;

      const paused = await campaignPromise;
      expect(paused.classification).toBe("REHEARSAL_PAUSED");
      const actualPauseCycle = readFhvRehearsalActualPauseCycle(runDir);
      expect(actualPauseCycle).toBeGreaterThanOrEqual(pauseAfterCycles);
      const checkpoint = readReplayCheckpoint(runDir);
      expect(checkpoint?.safeResumeThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(checkpoint?.evidenceDurableThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(readFhvRehearsalEvidenceTerminalState(runDir)).toBe(
        "STREAMING_EVIDENCE_SEALED_PARTIAL",
      );

      const stillPaused = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(stillPaused.classification).toBe("REHEARSAL_PAUSED");

      const resumeResult = await executor.execute({
        action: "RESUME_FROM_CHECKPOINT",
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        operatorId: "operator-1",
        reason: "hermetic resume test",
      });
      expect(resumeResult.outcome).toBe("accepted");
      expect(resumeResult.enforcementApplied).toBe(false);
      expect(executor.systemctlCalls).toHaveLength(0);
      expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(true);

      const completed = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-executor-e2e",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(completed.classification).toBe("REHEARSAL_OK");
      expect(completed.cyclesProcessed).toBeGreaterThan(actualPauseCycle!);
      expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(false);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.safeResumeThroughCycleIndex + 1).toBe(actualPauseCycle);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("pauses after original checkpoint boundary with exact frontier", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-late-pause-"));
    const sharedRunId = "fhv-late-pause";
    try {
      const runDir = prepareRunDir(root, sharedRunId);
      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: runDir,
      });

      const campaignPromise = runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: sharedRunId,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });

      await pauseViaExecutorWhenCyclesReach({
        runDir,
        minCycles: FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES,
        executor,
        runId: sharedRunId,
      });

      const paused = await campaignPromise;
      expect(paused.classification).toBe("REHEARSAL_PAUSED");
      const actualPauseCycle = readFhvRehearsalActualPauseCycle(runDir);
      expect(actualPauseCycle).toBeGreaterThanOrEqual(FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES);
      expect(actualPauseCycle).toBeGreaterThan(FHV_REHEARSAL_CHECKPOINT_CYCLE);
      expect(readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed).toBe(actualPauseCycle);

      const checkpoint = readReplayCheckpoint(runDir)!;
      expect(checkpoint.safeResumeThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(checkpoint.evidenceDurableThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(checkpoint.evidenceTerminalState).toBe("STREAMING_EVIDENCE_SEALED_PARTIAL");
      expect(readFhvRehearsalEvidenceTerminalState(runDir)).toBe(
        "STREAMING_EVIDENCE_SEALED_PARTIAL",
      );
      expect(restoreCanvasFromCheckpoint(runDir, checkpoint)).toBeTruthy();
      expect(checkpoint.safeResumeThroughCycleIndex + 1).toBe(actualPauseCycle);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("late pause parity matches uninterrupted digest and leaves evidence complete", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-late-parity-"));
    const uninterruptedRoot = mkdtempSync(join(tmpdir(), "fhv-campaign-late-uninter-"));
    const sharedRunId = "fhv-late-parity";
    try {
      const uninterruptedDir = prepareRunDir(uninterruptedRoot, sharedRunId);
      const parity = await runFhvRehearsalCampaignParityProof({
        runRootUninterrupted: uninterruptedDir,
        runRootPauseResume: prepareRunDir(root, sharedRunId),
        runId: sharedRunId,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        pauseAfterCycles: FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES,
      });
      expect(parity.match).toBe(true);
      expect(readFhvRehearsalEvidenceTerminalState(uninterruptedDir)).toBe("STREAMING_EVIDENCE_OK");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(uninterruptedRoot, { recursive: true, force: true });
    }
  }, 360_000);

  it("binds late pause classification to the requested cycle without polling races", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const root = mkdtempSync(join(tmpdir(), `fhv-campaign-late-race-${attempt}-`));
      const uninterruptedRoot = mkdtempSync(
        join(tmpdir(), `fhv-campaign-late-race-uninter-${attempt}-`),
      );
      const runId = `fhv-late-race-${attempt}`;
      try {
        const pauseResumeDir = prepareRunDir(root, runId);
        const parity = await runFhvRehearsalCampaignParityProof({
          runRootUninterrupted: prepareRunDir(uninterruptedRoot, runId),
          runRootPauseResume: pauseResumeDir,
          runId,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
          pauseAfterCycles: FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES,
        });
        expect(parity.match).toBe(true);
        expect(parity.actualPauseCycle).toBe(FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES);
        expect(readFhvRehearsalTerminalClassification(pauseResumeDir)).toBe("REHEARSAL_OK");
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(uninterruptedRoot, { recursive: true, force: true });
      }
    }
  }, 360_000);

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
      expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_TIMEOUT");

      const retry = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-timeout",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(retry.classification).toBe("REHEARSAL_TIMEOUT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects ordinary restart after terminal success", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-terminal-ok-"));
    try {
      const runDir = prepareRunDir(root, "fhv-terminal-ok");
      const first = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-terminal-ok",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(first.classification).toBe("REHEARSAL_OK");

      const second = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: "fhv-terminal-ok",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(second.classification).toBe("REHEARSAL_OK");
      expect(second.cyclesProcessed).toBe(first.cyclesProcessed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("allows a new unique run directory after terminal success", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-new-run-"));
    try {
      const firstDir = prepareRunDir(root, "fhv-first-run");
      const first = await runFhvRehearsalCampaign({
        runRoot: firstDir,
        runId: "fhv-first-run",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(first.classification).toBe("REHEARSAL_OK");

      const secondDir = prepareRunDir(root, "fhv-second-run");
      const second = await runFhvRehearsalCampaign({
        runRoot: secondDir,
        runId: "fhv-second-run",
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(second.classification).toBe("REHEARSAL_OK");
      expect(second.cyclesProcessed).toBe(first.cyclesProcessed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

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
