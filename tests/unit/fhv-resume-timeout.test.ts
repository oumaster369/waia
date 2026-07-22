import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  isFhvResumeFromCheckpointRequested,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalTerminalClassification,
  runFhvRehearsalCampaign,
  waitForFhvRehearsalCycles,
  writeFhvCampaignControlPauseRequest,
  writeFhvCampaignControlResumeRequest,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { isFhvCanonicalRunChainComplete } from "@/lib/trader/observability/fhv-canonical-run-chain";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-resume-timeout";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

describe("FHV resumed replay timeout boundary (DEE-431)", () => {
  it("times out during resume, consumes marker, and performs zero replay on restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-resume-timeout-"));
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
      await waitForFhvRehearsalCycles(runDir, 5);
      writeFhvCampaignControlPauseRequest(runDir, RUN_ID, ORG_ID);
      const paused = await pausePromise;
      expect(paused.classification).toBe("REHEARSAL_PAUSED");

      writeFhvCampaignControlResumeRequest(runDir, RUN_ID, ORG_ID);
      expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(true);

      const timedOut = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        monotonicDeadline: { deadlineMs: Date.now() - 1 },
      });
      expect(timedOut.classification).toBe("REHEARSAL_TIMEOUT");
      expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_TIMEOUT");
      expect(readFhvRehearsalCampaignProgress(runDir)?.phase).toBe("timeout");
      expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(false);
      expect(isFhvCanonicalRunChainComplete(runDir)).toBe(false);

      const before = readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed ?? 0;
      const again = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(again.classification).toBe("REHEARSAL_TIMEOUT");
      expect(readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});
