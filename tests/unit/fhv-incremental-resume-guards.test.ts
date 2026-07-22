import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as canvasCheckpoint from "@/lib/trader/backtest/canvas-checkpoint-integration";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  runFhvRehearsalCampaign,
  waitForFhvRehearsalCycles,
  writeFhvCampaignControlPauseRequest,
  writeFhvCampaignControlResumeRequest,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-incremental-resume-guards";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

describe("FHV incremental resume guards (DEE-431)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails resume when restoreCanvasFromCheckpoint returns null", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-resume-guard-restore-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;

      const pausePromise = runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      await waitForFhvRehearsalCycles(runDir, 45);
      writeFhvCampaignControlPauseRequest(runDir, RUN_ID, ORG_ID);
      await pausePromise;
      writeFhvCampaignControlResumeRequest(runDir, RUN_ID, ORG_ID);

      vi.spyOn(canvasCheckpoint, "restoreCanvasFromCheckpoint").mockImplementation(() => undefined);

      await expect(
        runFhvRehearsalCampaign({
          runRoot: runDir,
          runId: RUN_ID,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
        }),
      ).rejects.toThrow(/Canvas restore failed|FHV_REHEARSAL_CANVAS_RESTORE_FAILED/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});
