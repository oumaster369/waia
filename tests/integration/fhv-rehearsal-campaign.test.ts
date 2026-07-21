import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FHV_REHEARSAL_CHECKPOINT_CYCLE,
  readFhvRehearsalCampaignProgress,
  resolveFhvRehearsalEvidenceDir,
  runFhvRehearsalCampaign,
  runFhvRehearsalCampaignParityProof,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-rehearsal-campaign-test";
const ORG_ID = "00000000-0000-4000-8000-000000000416";

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

describe("FHV rehearsal campaign runner (DEE-431)", () => {
  it("runs uninterrupted WP03 rehearsal with progress and streaming evidence", async () => {
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
      expect(result.barsProcessed).toBeGreaterThan(FHV_REHEARSAL_CHECKPOINT_CYCLE);
      const progress = readFhvRehearsalCampaignProgress(runDir);
      expect(progress?.phase).toBe("completed");
      expect(existsSync(resolveFhvRehearsalEvidenceDir(runDir))).toBe(true);
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
      const completedProgress = readFhvRehearsalCampaignProgress(pauseResumeDir);
      expect(completedProgress?.phase).toBe("completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(uninterruptedRoot, { recursive: true, force: true });
    }
  }, 240_000);

  it("freezes progress when pause is requested before checkpoint completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-campaign-pause-"));
    try {
      const runDir = prepareRunDir(root);
      const { writeFileAtomic } =
        await import("@/lib/trader/backtest/streaming-evidence/atomic-file-write");
      writeFileAtomic(
        join(runDir, "control", "pause_at_checkpoint-request.v1.json"),
        '{"action":"PAUSE_AT_CHECKPOINT"}\n',
      );
      const paused = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(paused.classification).toBe("REHEARSAL_PAUSED");
      expect(paused.barsProcessed).toBe(FHV_REHEARSAL_CHECKPOINT_CYCLE);
      expect(readReplayCheckpoint(runDir)?.safeResumeThroughCycleIndex).toBe(
        FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
